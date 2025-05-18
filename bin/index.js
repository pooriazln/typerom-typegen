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

  const lifecycleDecorators = new Set([
    "AfterLoad",
    "BeforeInsert",
    "AfterInsert",
    "BeforeUpdate",
    "AfterUpdate",
  ]);

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths([
    path.join(entitiesDir, "**/*.entity.ts"),
    path.join(entitiesDir, "**/*.type.ts"),
  ]);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sourceFiles = project.getSourceFiles();
  const modelFileMap = {};
  const allInterfaceNames = [];

  // Register all model names
  sourceFiles.forEach((sf) => {
    sf.getClasses()
      .filter((cls) =>
        cls.getDecorators().some((d) => d.getName() === "Entity")
      )
      .forEach((cls) => {
        const name = cls.getName();
        if (name) {
          modelFileMap[name] = path.basename(sf.getFilePath(), ".entity.ts");
        }
      });
  });

  // Generate BaseModel from BaseEntity into base-model.ts
  const baseModelInterface = "BaseModel";
  const baseModelFile = path.join(outDir, `base-model.ts`);
  const baseClasses = project
    .getSourceFiles()
    .flatMap((sf) =>
      sf.getClasses().filter((c) => c.getName() === "BaseEntity")
    );

  if (baseClasses.length) {
    const baseCls = baseClasses[0];
    const baseProps = [];
    const autoBase = new Set();

    // detect lifecycle-assigned props
    baseCls.getMethods().forEach((m) => {
      const decs = m.getDecorators().map((d) => d.getName());
      if (decs.some((d) => lifecycleDecorators.has(d))) {
        m.getBody()
          ?.getDescendantsOfKind(SyntaxKind.BinaryExpression)
          .forEach((be) => {
            const lhs = be.getLeft();
            if (
              lhs.getKind() === SyntaxKind.PropertyAccessExpression &&
              lhs.getExpression().getText() === "this"
            ) {
              autoBase.add(lhs.getName());
            }
          });
      }
    });

    // include any decorator ending with 'Column'
    baseCls.getProperties().forEach((prop) => {
      const name = prop.getName();
      const decs = prop.getDecorators().map((d) => d.getName());
      const hasCol = decs.some((n) => n.endsWith("Column"));
      const isAuto = autoBase.has(name);
      if (!hasCol && !isAuto) return;
      baseProps.push({ name, type: prop.getType().getText() });
    });

    // write base-model.ts
    let baseContent = `// Auto-generated BaseModel from BaseEntity\n\n`;
    baseContent += `export interface ${baseModelInterface} {\n`;
    baseProps.forEach((p) => {
      baseContent += `  ${p.name}: ${p.type};\n`;
    });
    baseContent += `}\n`;

    fs.writeFileSync(baseModelFile, baseContent);
    console.log(`Generated BaseModel: ${baseModelFile}`);
  }

  // Generate models
  sourceFiles.forEach((sourceFile) => {
    const entityClasses = sourceFile
      .getClasses()
      .filter((cls) =>
        cls.getDecorators().some((dec) => dec.getName() === "Entity")
      );
    if (!entityClasses.length) return;

    const baseName = path.basename(sourceFile.getFilePath(), ".entity.ts");
    const outFile = path.join(outDir, baseName + ".ts");

    let fileContent = `// Auto-generated from ${path.basename(
      sourceFile.getFilePath()
    )}\n\n`;
    const imports = new Set();
    imports.add(`import { ${baseModelInterface} } from './base-model';`);
    const usedEnums = new Map();

    entityClasses.forEach((entityClass) => {
      const className = entityClass.getName() || "UnnamedModel";
      const interfaceName = `${className}Model`;
      allInterfaceNames.push({ file: baseName, name: interfaceName });
      const properties = [];

      // detect auto-loaded props
      const autoProps = new Set();
      entityClass.getMethods().forEach((method) => {
        const mdecs = method.getDecorators().map((d) => d.getName());
        if (mdecs.some((d) => lifecycleDecorators.has(d))) {
          method
            .getBody()
            ?.getDescendantsOfKind(SyntaxKind.BinaryExpression)
            .forEach((be) => {
              const lhs = be.getLeft();
              if (
                lhs.getKind() === SyntaxKind.PropertyAccessExpression &&
                lhs.getExpression().getText() === "this"
              ) {
                autoProps.add(lhs.getName());
              }
            });
        }
      });

      // process properties
      entityClass.getProperties().forEach((prop) => {
        const pName = prop.getName();
        const decorators = prop.getDecorators();
        const names = decorators.map((d) => d.getName());
        const hasColumn = names.some((n) => n.endsWith("Column"));
        const rel = decorators.find((d) => isRelationDecorator(d.getName()));
        const isVirtual = names.includes("VirtualColumn");
        const shouldAuto = autoProps.has(pName);
        if (!hasColumn && !rel && !shouldAuto) return;

        // relations
        if (rel) {
          const args = rel.getCallExpression()?.getArguments();
          const first = args?.[0];
          if (first?.getKind() === SyntaxKind.StringLiteral) {
            const target = first.getText().replace(/['"]/g, "");
            const mname = toModelName(target);
            if (target !== className) {
              imports.add(
                `import { ${mname} } from './${modelFileMap[target]}';`
              );
            }
            properties.push({
              name: pName,
              type: mname + (rel.getName() === "OneToMany" ? "[]" : ""),
            });
            return;
          }
        }

        // virtual columns
        if (isVirtual) {
          properties.push({ name: pName, type: prop.getType().getText() });
          return;
        }

        // auto-loaded props
        if (shouldAuto) {
          properties.push({ name: pName, type: prop.getType().getText() });
          return;
        }

        // fallback
        let tText = prop.getType().getText();
        const enumInfo = extractEnum(prop.getType());
        if (enumInfo) {
          usedEnums.set(enumInfo.name, enumInfo);
          tText = enumInfo.name;
        } else if (/\[\]$/.test(tText)) {
          const bt = tText.replace(/\[\]$/, "");
          if (modelFileMap[bt]) {
            const mn = toModelName(bt);
            imports.add(`import { ${mn} } from './${modelFileMap[bt]}';`);
            tText = mn + "[]";
          }
        } else if (modelFileMap[tText]) {
          const mn = toModelName(tText);
          imports.add(`import { ${mn} } from './${modelFileMap[tText]}';`);
          tText = mn;
        }
        properties.push({ name: pName, type: tText });
      });

      // build interface
      const propsStr = properties
        .map((p) => `  ${p.name}: ${p.type};`)
        .join("\n");
      fileContent += `export interface ${interfaceName} extends ${baseModelInterface} {\n${propsStr}\n}\n\n`;
    });

    // write file
    const impBlock = Array.from(imports).join("\n");
    fileContent = impBlock + "\n\n" + fileContent;

    usedEnums.forEach(({ name, members }) => {
      fileContent += `export enum ${name} {\n`;
      members.forEach(({ name: m, value }) => {
        fileContent += `  ${m} = ${JSON.stringify(value)},\n`;
      });
      fileContent += `}\n\n`;
    });

    fs.writeFileSync(outFile, fileContent.trim() + "\n");
    console.log(`Generated: ${outFile}`);
  });

  // index.d.ts
  const idx = allInterfaceNames
    .map((e) => `export * from './${e.file}';`)
    .join("\n");
  fs.writeFileSync(path.join(outDir, "index.ts"), idx + "\n");
  console.log("Generated index.d.ts");
}

main();
