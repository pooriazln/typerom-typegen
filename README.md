# typerom-typegen

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)
![ts-morph](https://img.shields.io/badge/ts--morph-0098EA?style=for-the-badge&logoColor=white)
![License](https://img.shields.io/badge/License-Apache_2.0-D2774B?style=for-the-badge)

A CLI that statically parses your TypeORM entities and generates plain TypeScript
interfaces from them — so your frontend can share the exact shape of your data
**without importing server code, a database driver, or TypeORM itself.**

No runtime, no DB connection. It reads your `*.entity.ts` files with `ts-morph`,
resolves relations and enums, and writes a clean `.models/` folder you can ship
anywhere.

## Why

Hand-copying entity types into the frontend rots the moment a column changes.
This keeps one source of truth (your entities) and regenerates the types on demand.

## Install

```bash
git clone https://github.com/pooriazln/typerom-typegen.git
cd typerom-typegen
npm install
npm i -g .        # exposes the `generate-models` command
```

## Usage

From your project root:

```bash
generate-models                                  # scans ./**/*.entity.ts → ./.models
generate-models --entitiesDir src --outDir types # custom in/out
```

| Flag | Default | Description |
|------|---------|-------------|
| `--entitiesDir` | `cwd` | Where to scan for `*.entity.ts` / `*.type.ts` |
| `--outDir` | `./.models` | Where to write the generated interfaces |

`node_modules`, `dist`, etc. are ignored automatically.

## Example

**In** — `user.entity.ts`:

```ts
@Entity()
export class User extends BaseEntity {
  @Column() email: string;
  @Column({ type: 'enum', enum: Role }) role: Role;
  @OneToMany('Post', 'author') posts: Post[];
}
```

**Out** — `.models/user.ts`:

```ts
import { BaseModel } from './base-model';
import { PostModel } from './post';

export interface UserModel extends BaseModel {
  email: string;
  role: Role;
  posts: PostModel[];
}

export enum Role {
  Admin = "admin",
  User = "user",
}
```

`BaseModel` is derived automatically from your `BaseEntity` class (any `*Column`
property plus fields set in lifecycle hooks like `@AfterLoad`), and an `index.ts`
barrel re-exports everything.

## What it handles

- `@Entity()` classes → `XModel` interfaces
- Relations → `@OneToMany` becomes `TargetModel[]`, others `TargetModel`
- `enum` columns → inlined `export enum`
- `@VirtualColumn` and lifecycle-assigned fields
- A shared `BaseModel` from `BaseEntity`

## Limitations

Static analysis only — it reads decorators, it doesn't run your code. Entities must
be untranspiled `.ts` with real `@Entity()` decorators, and you should have a
`BaseEntity` class for `BaseModel` to resolve.

## License

[Apache-2.0](./LICENSE)
