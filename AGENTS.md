# Project Development Guide for AI Agents

## Project Overview

- Project Name: TalkCody
- Description: Desktop AI Coding App for macOS

## Technology Stack

### Frontend

- Framework: React 19
- Language: TypeScript
- Styling: Tailwind CSS + Shadcn UI
- Testing: Vitest
- State Management: Zustand

### Backend

- Framework: Tauri 2
- Language: Rust

### Database

- Type: SQLite

### AI Integration

- SDK: Vercel AI SDK 5.0

## Project Structure

```
talkcody/
│
├── src/                    # Main source code directory
│   ├── components/         # React UI components
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility functions and shared logic
│   ├── pages/              # Page components
│   ├── styles/             # Global styles and CSS
│   └── types/              # TypeScript type definitions
|   ├── services/           # AI, database and other services
|   ├── utils/
│
├── src-tauri/              # Rust backend code
│   ├── src/                # Rust source files
│   ├── Cargo.toml
│   └── tauri.conf.json
|   package.json
|   tsconfig.json
|   vite.config.ts
```

### Backend API Service

apps/api/ - API Service

Test Command:
```
cd apps/api
bun run test
```

### Important Notes

- The docs directory is the user documentation website and does not need to be modified during development.

## Development Guidelines

1. Frontend Development Rules:
   - Solve functions on the frontend using TypeScript when possible
   - Using Functional Components with Hooks (Classless Components)
   - Use Shadcn UI components (no need to provide source code)
   - Use English for comments and text

2. Naming Conventions:
   - File names: kebab-case (e.g., `user-profile.ts`)
   - Use Sonner component for toast notifications

3. Bug fixing:
   - must write a test case to cover the bug
   - Fix the bug and ensure all tests pass

4. Validation and Linting:
   - Use `bun run lint` to check code quality before committing changes.
   - Use `bun run tsc` to ensure type safety.
   - Use `bun run test` to run all tests and ensure functionality.

### bun run lint Fixes

- Cannot modify the rules in biome.json; only fix code to pass lint checks.
- When fixing code, try to keep the original logic unchanged and avoid introducing new issues.
- Perform fixes in parallel as much as possible to reduce fixing time.
- Do not use biome's unsafe fixes; you should manually fix the code.

## Useful Bash Commands

### Project Setup

```bash
# Run Tauri app
bun run tauri dev

# Build Tauri app
bun run tauri build
```

### Development Workflow

```bash

bun run tsc

# Lint code
bun run lint

# Run tests
bun run test

# build
bun run build
```

### Log Directory

TalkCody runtime log path:

```
~/Library/Logs/com.talkcody/talkcody.log
```

### App data directory

TalkCody app data path:

```
~/Library/Application Support/com.talkcody
```

## AI Code Generation Tips

### Turso database

### Files import in TS code

you should use '@tauri-apps/api/path'. like this:

```typescript
import { join, normalize, isAbsolute, appDataDir, dirname} from '@tauri-apps/api/path';
```


When generating code, consider:

- Follow React functional component patterns
- Use Tailwind CSS for styling
- Implement responsive design
- UI must support dark mode
- Use accurate type definitions and do not use `any` types
- Keep components modular and reusable
- Use React hooks for state management
- Use Vercel AI SDK for AI-related functionality
- Try to avoid using dynamic imports