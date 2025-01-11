# TypeORM .d.ts Generator

A simple CLI tool that scans your TypeORM `*.entity.ts` files, extracts decorators like `@Entity()`, `@Column()`, `@OneToMany()`, etc., and generates corresponding `.d.ts` interface files. Perfect for sharing entity structures with frontend applications or other consumers who need type definitions without bundling your entire server code.

---

## Features

- **Automatic .d.ts generation** – Creates an interface for each `@Entity()` class.
- **Handles relations** – Decorators such as `@OneToMany('User', 'posts')` become `UserModel[]`.=
- **Lightweight** – No need to run a database or start a server; just parse your `.entity.ts` files.

---

## Quick Start

1.  **Clone the repository:**

        git clone https://github.com/pooriazln/typerom-typegen.git
        cd typerom-typegen

2.  **Install dependencies** using your preferred package manager (npm, pnpm, or yarn). For example:

        npm install

3.  **Install the CLI globally:**

        npm i -g .

4.  **Create a `base-model.d.ts` file:**

    In your project, create a file named `base-model.d.ts` and add the following:

    ```ts
    interface BaseModel {
      id: string;
      createdAt: Date;
      updatedAt: Date;
    }
    ```

    This ensures that all generated model interfaces extend this base interface.

5.  **Use** the CLI in your project root. Simply run:

        generate-models

    By default, it will scan for any `*.entity.ts` in the current directory (recursively) and generate `.d.ts` files in a folder named `.models/`.

---

## Typical NestJS Workflow

If your entities are spread across multiple modules, simply run `generate-models` from your project root (after installing it globally). The tool will **ignore** common directories like `node_modules`, `dist`, etc. If you have an unusual project structure, you can specify multiple directories or use globs.

---

## Troubleshooting

- **No files generated**: Make sure you are in the **project root** containing your `.entity.ts` files (or pass `--entitiesDir` pointing to the source folder).
- **Empty interfaces**: Ensure the files are untranspiled `.ts` (not compiled `.js`) and you have `@Entity()` decorators.
- **Errors**: Check if you have the right permissions and that your entities do not live in ignored folders (`node_modules`, etc.).

---

## Contributing

Feel free to submit issues or PRs if you find bugs or have feature requests. This tool aims to handle the most common patterns in TypeORM entity definitions, but edge cases or advanced configurations can arise.

---

## License

MIT License. See [LICENSE](./LICENSE) for more details. Enjoy generating those types!
