#!/usr/bin/env node

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

function toModelName(className) {
  return className + "Model";
}

function extractEnum(enumType) {
  const enumDecl = enumType.getSymbol()?.getDeclarations()?.[0];
  if (
    !enumDecl ||
    !enumDecl.getKind ||
    enumDecl.getKind() !== SyntaxKind.EnumDeclaration
  )
    return null;

  const name = enumDecl.getName();
  const members = enumDecl.getMembers().map((m) => ({
    name: m.getName(),
    value: m.getValue(),
  }));

  return { name, members };
}

function main() {
  const { entitiesDir, outDir } = parseArgs(process.argv.slice(2));

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(path.join(entitiesDir, "**/*.entity.ts"));

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sourceFiles = project.getSourceFiles();

  const modelFileMap = {}; // Map className => file name (for imports)
  const enumMap = {}; // Map enumName => { name, members }
  const allInterfaceNames = [];

  // First pass: register all model names
  sourceFiles.forEach((sf) => {
    sf.getClasses()
      .filter((cls) =>
        cls.getDecorators().some((d) => d.getName() === "Entity")
      )
      .forEach((cls) => {
        const name = cls.getName();
        if (name)
          modelFileMap[name] = path.basename(sf.getFilePath(), ".entity.ts");
      });
  });

  sourceFiles.forEach((sourceFile) => {
    const entityClasses = sourceFile
      .getClasses()
      .filter((cls) =>
        cls.getDecorators().some((dec) => dec.getName() === "Entity")
      );

    if (!entityClasses.length) return;

    const baseName = path.basename(sourceFile.getFilePath(), ".entity.ts");
    const tsFileName = path.join(outDir, baseName + ".ts");

    let fileContent = `// Auto-generated from ${path.basename(
      sourceFile.getFilePath()
    )}\n\n`;
    const imports = new Set();
    const usedEnums = new Map();

    for (const entityClass of entityClasses) {
      const className = entityClass.getName() || "UnnamedModel";
      const interfaceName = `${className}Model`;
      allInterfaceNames.push({ file: baseName, name: interfaceName });

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
            if (isRelationDecorator(decName)) relationDecoratorName = decName;
          }
        }

        if (!isTypeormProperty) continue;

        if (relationDecoratorName) {
          const relationDec = decorators.find((d) =>
            isRelationDecorator(d.getName())
          );
          const args = relationDec?.getCallExpression()?.getArguments();
          const firstArg = args?.[0];

          if (firstArg?.getKind() === SyntaxKind.StringLiteral) {
            const targetEntity = firstArg.getText().replace(/['"]/g, "");
            const modelName = toModelName(targetEntity);
            if (targetEntity !== className) {
              imports.add({
                name: modelName,
                path: `./${modelFileMap[targetEntity]}`,
              });
            }
            properties.push({
              name: prop.getName(),
              type:
                modelName + (relationDecoratorName === "OneToMany" ? "[]" : ""),
            });
            continue;
          }
        }

        // Fallback to property type
        const type = prop.getType();
        let typeText = type.getText();

        // Inline enums
        if (
          type.getSymbol()?.getDeclarations()?.[0]?.getKind() ===
          SyntaxKind.EnumDeclaration
        ) {
          const enumInfo = extractEnum(type);
          if (enumInfo) {
            usedEnums.set(enumInfo.name, enumInfo);
            typeText = enumInfo.name;
          }
        } else if (/\[\]$/.test(typeText)) {
          const baseType = typeText.replace(/\[]$/, "");
          if (modelFileMap[baseType]) {
            imports.add({
              name: toModelName(baseType),
              path: `./${modelFileMap[baseType]}`,
            });
            typeText = toModelName(baseType) + "[]";
          }
        } else if (modelFileMap[typeText]) {
          imports.add({
            name: toModelName(typeText),
            path: `./${modelFileMap[typeText]}`,
          });
          typeText = toModelName(typeText);
        }

        properties.push({ name: prop.getName(), type: typeText });
      }

      const propsString = properties
        .map((p) => `  ${p.name}: ${p.type};`)
        .join("\n");
      fileContent += `export interface ${interfaceName} extends BaseModel {\n${propsString}\n}\n\n`;
    }

    // Add imports at the top
    let importLines = "";
    imports.forEach((imp) => {
      if (imp.path !== `./${baseName}`) {
        importLines += `import { ${imp.name} } from '${imp.path}';\n`;
      }
    });
    if (importLines) fileContent = importLines + "\n" + fileContent;

    // Add inlined enums at the bottom
    usedEnums.forEach((enumObj) => {
      const members = enumObj.members
        .map((m) => `  ${m.name} = ${JSON.stringify(m.value)},`)
        .join("\n");
      fileContent += `export enum ${enumObj.name} {\n${members}\n}\n\n`;
    });

    fs.writeFileSync(tsFileName, fileContent.trim() + "\n");
    console.log(`✅ Generated: ${tsFileName}`);
  });

  // Generate index.d.ts
  const indexContent = allInterfaceNames
    .map((entry) => `export * from './${entry.file}';`)
    .join("\n");

  fs.writeFileSync(path.join(outDir, "index.d.ts"), indexContent);
  console.log("Generated: index.d.ts");

  console.log("✨ Done generating .ts model files!");
}

main();
