# Beginner's Guide to SassyAuth

Welcome to SassyAuth! This guide is designed to help junior developers understand how this monorepo is structured, how the different parts communicate, and how to start contributing.

## 🏗 The Big Picture: Monorepo Structure

SassyAuth uses a **Monorepo** architecture managed by **Turborepo** and **pnpm**. Instead of having multiple separate repositories, everything lives in one place.

### Why a Monorepo?
- **Shared Code:** We can easily share types and UI components between the API and the Admin console.
- **Atomic Changes:** You can update a database schema and the code that uses it in a single pull request.
- **Consistent Tooling:** Linting, testing, and building are standardized across the whole project.

### Folder Layout
- `apps/`: Contains the actual applications.
  - `auth-server/`: The backend API (NestJS).
  - `admin/`: The frontend management console (Next.js).
- `packages/`: Contains shared code used by the apps.
  - `db/`: Prisma schema and database client.
  - `types/`: Shared TypeScript interfaces and constants.
  - `ui/`: Shared React components (Tailwind + Radix).

---

## 🛠 Shared Packages

### 1. `@sassy-auth/db`
This package manages our PostgreSQL database using **Prisma**.
- **Schema:** Defined in `packages/db/prisma/schema.prisma`.
- **Usage:** Other apps import the `prisma` client from here.
- **Key Command:** `pnpm --filter @sassy-auth/db db:migrate` to update your local database.

### 2. `@sassy-auth/types`
Contains TypeScript definitions that both the backend and frontend use. This ensures that if we change a "User" object in the API, the frontend will immediately know about it through TypeScript errors.

### 3. `@sassy-auth/ui`
Our design system. It contains reusable components like `Button`, `Input`, `DataTable`, and `Sheet`.
- Built with **Tailwind CSS** and **Radix UI**.
- Located in `packages/ui/src/components`.

---

## 🚀 The API: `auth-server` (NestJS)

The `auth-server` is a **NestJS** application. It handles authentication, user management, and issues JWTs.

### How API Routes Work
NestJS organizes code into **Modules**. Each module typically has:
- **Controller:** Defines the URL routes (e.g., `@Get('/users')`).
- **Service:** Contains the business logic (e.g., `this.prisma.user.findMany()`).
- **Module:** Ties the controller and service together.

**Key Modules:**
- `auth/`: Integration with **BetterAuth** for handling login sessions.
- `token/`: Handles OAuth2 flows and generating JWTs for resource servers.
- `users/`: CRUD operations for users.
- `invitations/`: Logic for sending and accepting user invites.

### BetterAuth Integration
We use **BetterAuth** for session management. It's mounted as middleware in `main.ts` and handles routes under `/api/auth/*` (like login, sign-out, etc.) before they even reach NestJS.

---

## 💻 The Frontend: `admin` (Next.js)

The `admin` app is a **Next.js 15** application using the **App Router**.

### How UI Routes Work
Next.js uses file-based routing in the `app/` directory:
- `app/login/page.tsx` → Accessible at `/login`.
- `app/(admin)/users/page.tsx` → Accessible at `/users`. (The `(admin)` folder is a "Route Group" used for shared layouts without affecting the URL).

### Server Actions
Instead of writing traditional `fetch` calls in the browser, we use **Server Actions**.
- Look at `apps/admin/app/(admin)/users/actions.ts`.
- These are functions that run on the server but can be called directly from your React components.

### Communication with the API
The Admin app talks to the `auth-server` using helper functions in `apps/admin/lib/api.ts`.
- **Session Forwarding:** When the Admin app calls the API, it forwards the user's session cookie so the API knows who is logged in.

---

## 🔄 How the Apps Work Together

1. **User Logs In:** The user goes to `/login` in the `admin` app.
2. **Session Created:** BetterAuth creates a session cookie.
3. **Admin Dashboard:** The `admin` app checks this session. If valid, it shows the dashboard.
4. **Fetching Data:** To show the user list, the `admin` app (on the server) calls `GET http://localhost:3000/api/users` via the `getUsers()` helper, forwarding the session cookie.
5. **API Response:** The `auth-server` validates the session, fetches users from the database using `@sassy-auth/db`, and returns them.

---

## 💡 Tips for Junior Developers

1. **Running Everything:** Just run `pnpm dev` in the root. Turbo will start both the API and the UI for you.
2. **Finding Components:** If you see a UI element you want to change, check if it's in `apps/admin/components` (specific to the admin) or `packages/ui/src/components` (shared).
3. **TypeScript is Your Friend:** If you see a red squiggly line, hover over it! Usually, it's telling you that a property is missing or the type is wrong.
4. **Environment Variables:** Make sure your `.env.local` is set up correctly in the root. If something isn't connecting, check the URLs in your `.env.local`.
5. **Logs:** Watch the terminal where you ran `pnpm dev`. You'll see logs from both `auth-server` and `admin` tagged with different colors.

Happy coding! If you get stuck, check the `docs/` folder or the main `README.md` for more technical details.
