#!/usr/bin/env node

/**
 * generate-models.js
 *
 * An example script using ts-morph to generate .d.ts from TypeORM entity classes.
 *
 * Usage:
 *   node generate-models.js --entitiesDir "path/to/src" --outDir "path/to/.models"
 */

import fs from "fs";
import path from "path";
import { Project, SyntaxKind } from "ts-morph";

function parseArgs(args) {
  const result = {
    entitiesDir: process.cwd(),
    outDir: path.join(process.cwd(), ".models"),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--entitiesDir" && args[i + 1]) {
      result.entitiesDir = path.resolve(args[i + 1]);
    }
    if (args[i] === "--outDir" && args[i + 1]) {
      result.outDir = path.resolve(args[i + 1]);
    }
  }
  return result;
}

function isRelationDecorator(decoratorName) {
  return [
    "OneToMany",
    "ManyToOne",
    "OneToOne",
    "ManyToMany",
    "JoinTable",
    "JoinColumn",
  ].includes(decoratorName);
}

// A helper to convert something like "Invoice" -> "InvoiceModel"
function toModelName(className) {
  return className + "Model";
}

function main() {
  const { entitiesDir, outDir } = parseArgs(process.argv.slice(2));

  // 1. Create a ts-morph Project.
  // We can optionally point it to a tsconfig if we want the full environment.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });

  // 2. Add all *.entity.ts files in the given folder (recursively).
  // If you also want subdirectories, you can do "**/*.entity.ts".
  project.addSourceFilesAtPaths(path.join(entitiesDir, "**/*.entity.ts"));

  // If you want to explicitly ignore node_modules or other dirs, do so before adding:
  // e.g., project.addSourceFilesAtPaths("!node_modules"); etc.

  // 3. Ensure outDir exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 4. For each source file, parse the entities
  const sourceFiles = project.getSourceFiles();
  if (!sourceFiles.length) {
    console.log("No .entity.ts files found in:", entitiesDir);
    return;
  }

  sourceFiles.forEach((sourceFile) => {
    // We'll gather all the classes with @Entity
    const entityClasses = sourceFile
      .getClasses()
      .filter((cls) =>
        cls.getDecorators().some((dec) => dec.getName() === "Entity")
      );

    if (!entityClasses.length) {
      // This file might have no @Entity classes
      return;
    }

    // We'll create a single .d.ts file per sourceFile, e.g. user.entity.ts -> user.d.ts
    const baseName = path.basename(sourceFile.getFilePath(), ".entity.ts");
    const dtsFileName = path.join(outDir, baseName + ".d.ts");

    let fileContent = `// Auto-generated from ${path.basename(
      sourceFile.getFilePath()
    )}\n\n`;

    for (const entityClass of entityClasses) {
      // E.g. "User"
      const className = entityClass.getName() || "UnnamedModel";
      const interfaceName = `${className}Model`;

      // Gather properties decorated with @Column, @OneToMany, etc.
      const properties = [];
      for (const prop of entityClass.getProperties()) {
        const decorators = prop.getDecorators();
        if (decorators.length === 0) continue;

        let isTypeormProperty = false;
        let relationDecoratorName = null;

        for (const dec of decorators) {
          const decName = dec.getName();
          if (decName === "Column" || isRelationDecorator(decName)) {
            isTypeormProperty = true;
            if (isRelationDecorator(decName)) {
              relationDecoratorName = decName;
            }
          }
        }

        if (!isTypeormProperty) continue;

        // If it's a relation, check if we have the entity name in the decorator arguments
        // e.g. @OneToMany("Invoice", "user")
        if (relationDecoratorName) {
          const relationDec = decorators.find((d) =>
            isRelationDecorator(d.getName())
          );
          if (relationDec) {
            // Get the arguments from the decorator
            const args = relationDec.getCallExpression().getArguments();
            if (args.length > 0) {
              const firstArg = args[0];
              if (firstArg.getKind() === SyntaxKind.StringLiteral) {
                const targetEntityName = firstArg
                  .getText()
                  .replace(/['"]/g, "");
                // OneToMany => array
                if (relationDecoratorName === "OneToMany") {
                  properties.push({
                    name: prop.getName(),
                    type: toModelName(targetEntityName) + "[]",
                  });
                  continue;
                } else {
                  // ManyToOne, OneToOne, etc => single
                  properties.push({
                    name: prop.getName(),
                    type: toModelName(targetEntityName),
                  });
                  continue;
                }
              }
            }
          }
        }

        // If it's not recognized as a relation, or couldn't parse it,
        // we can attempt to resolve the TS type or fallback to 'any'.
        let typeText = "any";
        const propType = prop.getType();
        // e.g. 'string', 'number', 'RoleEnum', etc.
        const propTypeText = propType.getText();

        // If it's something like 'Invoice[]', we can transform to 'InvoiceModel[]'
        if (/\[\]$/.test(propTypeText)) {
          typeText = propTypeText.replace(/\[]$/, "Model[]");
        } else if (
          /^[A-Z]/.test(propTypeText) &&
          !["String", "Number", "Boolean", "Date"].includes(propTypeText)
        ) {
          // 'Invoice' -> 'InvoiceModel'
          typeText = propTypeText + "Model";
        } else {
          // fallback to whatever we got
          typeText = propTypeText;
        }

        properties.push({
          name: prop.getName(),
          type: typeText,
        });
      } // end for (const prop)

      // Construct the interface for this entity class
      const propsString = properties
        .map((p) => `  ${p.name}: ${p.type};`)
        .join("\n");
      fileContent += `interface ${interfaceName} extends BaseModel {\n${propsString}\n}\n\n`;
    } // end for (const entityClass)

    // Write to the .d.ts file
    fs.writeFileSync(dtsFileName, fileContent.trim() + "\n");
    console.log(`Generated: ${dtsFileName}`);
  });

  console.log("Done generating .d.ts files!");
}

main();
