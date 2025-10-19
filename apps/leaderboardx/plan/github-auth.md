# GitHub OAuth Integration and Profile README Editor Implementation Plan

This document outlines the plan to integrate GitHub OAuth into the Next.js static application, enabling users to authenticate and link their crypto wallet addresses, which will be stored in their GitHub profile READMEs. The process is facilitated by a minimal Cloudflare Worker for token exchange.

## Phase 1: Setup and Backend Authentication Handler (Cloudflare Worker)

This phase focuses on setting up the necessary GitHub OAuth application and the Cloudflare Worker that will handle the secure exchange of the authorization code for an access token.

### Task 1.1: GitHub OAuth Application Registration - DONE

1.  **Action**: Navigate to GitHub Developer settings and register a new OAuth App.
2.  **Details**:
    - **Application Name**: e.g., "ElizaOS Profile Editor"
    - **Homepage URL**: Your deployed Next.js application URL (e.g., `https://elizaos.github.io`).
    - **Authorization callback URL**: The callback URL within your Next.js application where GitHub will redirect the user after authorization. This URL must match the `NEXT_PUBLIC_REDIRECT_URI` environment variable used by your Next.js application (e.g., `https://elizaos.github.io/auth/callback` or `http://localhost:3000/auth/callback`).
3.  **Output**: Securely store the generated **Client ID** and **Client Secret**.

### Task 1.2: Cloudflare Worker Project Setup - DONE

1.  **Directory**: Create a new directory, e.g., `auth-worker`, at the project root.
2.  **Configuration (`wrangler.toml`)**:
    - Define worker `name`, `main` entry point (e.g., `src/index.ts`), and `compatibility_date`.
    - Set up `[build]` command if using TypeScript (e.g., `npm run build` with `tsc`).
    - Define `[vars]` for local development (e.g., `ALLOWED_ORIGIN = "http://localhost:3000"`).
    - Note that `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` will be configured as secrets in the Cloudflare dashboard for production.
3.  **TypeScript**: If not using a template, set up `tsconfig.json` and install necessary types (`@cloudflare/workers-types`).

### Task 1.3: Implement Cloudflare Worker Logic (`auth-worker/src/index.ts`) - DONE

1.  **Main Handler**: Implement the `fetch` event listener.
    - Route requests based on `url.pathname` (e.g., `/api/auth/callback`, `/api/status`).
    - Handle CORS preflight (`OPTIONS`) requests and add appropriate CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, etc.) to all responses, ensuring `env.ALLOWED_ORIGIN` is used.
2.  **Callback Handler (`handleCallback` function)**:
    - Extract `code` and `state` from the request URL. (State verification is primarily a client-side concern before calling this worker, but the worker could also be designed to expect a state relayed by the client).
    - Make a `POST` request to `https://github.com/login/oauth/access_token`.
      - **Payload**: `client_id`, `client_secret` (from `env`), and `code`.
      - **Headers**: `Content-Type: application/json`, `Accept: application/json`.
    - Parse the JSON response from GitHub.
    - **Security**: Check if the `scope` in the response includes `'public_repo'`. If not, return an error.
    - Return the `access_token`, `token_type`, and `scope` to the Next.js client as a JSON response.
    - Implement comprehensive error handling for fetch failures or errors from GitHub.
    ```typescript
    // Pseudocode for token exchange in Worker:
    // async function handleCallback(request, env) {
    //   const code = new URL(request.url).searchParams.get('code');
    //   const response = await fetch('https://github.com/login/oauth/access_token', {
    //     method: 'POST',
    //     headers: { /* ... */ },
    //     body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, /* ... */ code }),
    //   });
    //   const tokenData = await response.json();
    //   if (!tokenData.scope?.includes('public_repo')) { /* return error */ }
    //   return new Response(JSON.stringify(tokenData), { headers: { /* CORS */ }});
    // }
    ```

### Task 1.4: Deploy and Configure Cloudflare Worker - DONE

1.  **Deployment**: Use Wrangler CLI (`bunx wrangler deploy`) to deploy the worker.
2.  **Secrets**: In the Cloudflare dashboard (or via Wrangler CLI), set the following secrets for the deployed worker:
    - `GITHUB_CLIENT_ID`
    - `GITHUB_CLIENT_SECRET`
    - `ALLOWED_ORIGIN` (the URL of your deployed Next.js application).
3.  **Update OAuth App**: Ensure the "Authorization callback URL" in your GitHub OAuth App settings matches the deployed worker's callback endpoint.

## Phase 2: Frontend Authentication Core (Next.js)

This phase involves setting up the Next.js frontend to handle the user-facing part of the authentication flow, manage auth state, and interact with the Cloudflare Worker.

### Task 2.1: Configure Next.js Environment Variables - DONE

1.  **File**: Create/update `.env` or `.env.local`.
2.  **Variables**:
    - `NEXT_PUBLIC_GITHUB_CLIENT_ID`: Your GitHub OAuth App's Client ID.
    - `NEXT_PUBLIC_AUTH_WORKER_URL`: The full URL of your deployed Cloudflare Worker.
    - `NEXT_PUBLIC_APP_URL`: The base URL of your Next.js application (e.g., `http://localhost:3000` for dev, `https://elizaos.github.io` for prod).
    - `NEXT_PUBLIC_REDIRECT_URI`: The callback URL _within your Next.js app_ where GitHub will redirect the user after authorization (e.g., `${NEXT_PUBLIC_APP_URL}/auth/callback`).

### Task 2.2: Create Authentication Context (`src/contexts/AuthContext.tsx`) - DONE

1.  **Purpose**: A React Context to manage global authentication state (user object, token, loading status, errors) and provide auth-related functions.
2.  **State**: `user`, `token`, `isLoading`, `error`.
3.  **Functions**:
    - `login()`:
      - Generates a `state` string for CSRF protection and stores it in `localStorage`.
      - Constructs the GitHub authorization URL: `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri` (pointing to `/auth/callback` in Next.js app), `scope=read:user,public_repo`, and the generated `state`.
      - Redirects the user to this URL.
    - `logout()`: Clears the `token` and `user` from state and `localStorage`. Resets `oauth_state`.
    - `fetchUserData(accessToken)`:
      - Makes a GET request to `https://api.github.com/user` with the `accessToken`.
      - Updates `user` state. Handles errors (e.g., 401 for invalid token).
    - `handleAuthCallback(code, receivedState)`:
      - Retrieves and verifies the `savedState` from `localStorage` against `receivedState`.
      - Makes a GET request to the Cloudflare Worker's callback endpoint (e.g., `${NEXT_PUBLIC_AUTH_WORKER_URL}/api/auth/callback?code=${code}`).
      - On success, receives `access_token` from the worker.
      - Stores the token in `localStorage`.
      - Calls `fetchUserData()` with the new token.
      - Navigates the user (e.g., to the homepage).
4.  **Effect**: `useEffect` hook to check `localStorage` for an existing token on app initialization and call `fetchUserData` if found.

### Task 2.3: Integrate AuthProvider in `src/app/layout.tsx` - DONE

1.  **Action**: Wrap the main children of your `RootLayout` component with the `<AuthProvider>`.
    ```tsx
    // Example in src/app/layout.tsx
    // import { AuthProvider } from '@/contexts/AuthContext';
    // <AuthProvider>
    //   {/* ... rest of your layout ... */}
    //   {children}
    // </AuthProvider>
    ```

### Task 2.4: Implement OAuth Callback Page (`src/app/auth/callback/page.tsx`) - DONE

1.  **Purpose**: This Next.js page handles the redirect from GitHub after the user authorizes the app.
2.  **Logic**:
    - Use `useSearchParams()` from `next/navigation` to extract the `code` and `state` query parameters.
    - Call the `handleAuthCallback(code, state)` function from `useAuth()`.
    - Render loading indicators or error messages based on the `isLoading` and `error` state from `AuthContext`.
    - Ensure this page is wrapped with `<Suspense>` due to `useSearchParams`.

### Task 2.5: Create UI for Auth Controls (`src/components/AuthControls.tsx`) - DONE

1.  **Functionality**: A component that displays a "Login with GitHub" button if the user is not authenticated, or user information (avatar, name) and a dropdown menu if authenticated.
2.  **Implementation**:
    - Use `useAuth()` hook to get `user`, `isLoading`, `login`, `logout`.
    - Employ shadcn/ui components: `Button` for login/logout, `Avatar` for user display.
    - **DropdownMenu**: For authenticated users, the dropdown should include a "Link Wallets" option.
      - This option should link to the `/profile/edit` route.
      - Consider using a `Wallet` icon (e.g., from Lucide React icons) for this menu item.
    ```tsx
    // Example for DropdownMenuItem in AuthControls.tsx
    // import { Wallet } from 'lucide-react'; // Or other appropriate icon
    // <DropdownMenuItem asChild>
    //   <Link href="/profile/edit">
    //     <Wallet className="mr-2 h-4 w-4" />
    //     <span>Link Wallets</span>
    //   </Link>
    // </DropdownMenuItem>
    ```

### Task 2.6: Add AuthControls to Header/Navigation - DONE

1.  **Integration**: Place the `<AuthControls />` component in a visible part of the application header, likely within `src/app/layout.tsx` alongside the `<Navigation />` and `<ThemeToggle />` components.

## Phase 3: Wallet Linking and GitHub Profile README Update

This phase covers creating a service to interact with the GitHub API and building the UI for users to link their Ethereum and Solana wallet addresses, which will be saved to their GitHub profile README.

### Task 3.1: Create GitHub API Service (`src/lib/walletLinking/githubService.ts`) - DONE

1.  **Purpose**: A centralized TypeScript module for making authenticated requests to the GitHub API.
2.  **Helper Function**: `makeGitHubApiRequest(endpoint, token, options)`: A generic internal function to handle common logic like setting Authorization headers and base URL, and basic error handling.
3.  **Key Functions**:
    - `getAuthenticatedUser(token: string): Promise<GitHubUser>`: Fetches user data from `/user`.
    - `getRepo(token: string, owner: string, repoName: string): Promise<GitHubRepo>`: Fetches repo details from `/repos/{owner}/{repoName}`.
    - `createRepo(token: string, repoName: string, description: string, autoInit: boolean = true): Promise<GitHubRepo>`: Creates a new repository via `POST /user/repos`.
    - `getFileContent(token: string, owner: string, repoName: string, filePath: string): Promise<GitHubFileContent | null>`: Fetches file content (and SHA) from `/repos/{owner}/{repoName}/contents/{filePath}`. Should handle 404 by returning `null` if file doesn't exist. Content will be base64.
    - `updateFile(token: string, owner: string, repoName: string, filePath: string, message: string, content: string, sha?: string): Promise<UpdateFileResponse>`: Creates or updates a file via `PUT /repos/{owner}/{repoName}/contents/{filePath}`.
      - `content`: Plain text, needs to be Base64 encoded before sending (`btoa()`).
      - `sha`: Required if updating an existing file.

### Task 3.2: Implement "Link Wallet Addresses" Page (`src/app/profile/edit/page.tsx`) - DONE

1.  **Route Protection**: Use `useAuth()` to check for an authenticated user and token. Redirect to login or homepage if not authenticated.
2.  **Page Title/Focus**: The page should be titled "Link Wallet Addresses" or similar, focusing on this specific task.
3.  **Data Fetching (`useEffect`)**:
    - On component mount (and when `user` or `token` changes), if authenticated:
      - Call `githubService.getRepo` to check if the user's profile repository (`username/username`) exists.
      - If it exists, call `githubService.getFileContent` to fetch `README.md`. Decode content from Base64 (`atob()`).
      - **Parse existing addresses**: Implement logic to parse previously saved ETH and SOL addresses from the README content (e.g., by looking for the specific markers and structure defined below). Populate the form with these addresses if found.
      - Store the full README content and its SHA in local state to preserve other content.
      - Set loading and error states appropriately.
4.  **Submit Handler (`handleLinkWallets`)**:
    - Takes new `ethAddress` and `solAddress` as input from `WalletLinkForm.tsx`.
    - Retrieves the current full README content (and SHA) from state.
    - **Construct Wallet Section**:
      - Define a clear, machine-parsable, and human-readable format for the wallet addresses within HTML comments to act as markers. This allows for easy identification and updates.
      ```markdown
      <!-- BEGIN ELIZAOS_PROFILE_WALLETS -->
      <div id="elizaos-linked-wallets" style="margin-top: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
        <h3>My Linked Wallet Addresses</h3>
        <p><strong>Ethereum (ETH):</strong> <code>${ethAddress || 'Not set'}</code></p>
        <p><strong>Solana (SOL):</strong> <code>${solAddress || 'Not set'}</code></p>
        <p><small>Managed by ElizaOS Profile</small></p>
      </div>
      <!-- END ELIZAOS_PROFILE_WALLETS -->
      ```
    - **Update README Content**:
      - If the wallet section (identified by `<!-- BEGIN ELIZAOS_PROFILE_WALLETS -->` and `<!-- END ELIZAOS_PROFILE_WALLETS -->`) already exists in the fetched README content, replace the entire section between these markers with the newly constructed wallet section.
      - If the markers are not found, append the new wallet section to the end of the existing README content. Ensure there's a newline before appending if the existing content doesn't end with one.
    - If the profile repository doesn't exist, call `githubService.createRepo` first. The initial README created by `auto_init: true` in `createRepo` will then be updated, or if `auto_init` is false, this `handleLinkWallets` function will be creating the first `README.md`. It's simpler if `createRepo` initializes with a basic README.
    - Call `githubService.updateFile` to create/update `README.md` with the _new complete README content_. Provide a commit message like "Update linked wallet addresses".
    - Handle success and error responses, updating UI messages.
5.  **UI**:
    - Use shadcn `Card` for structure. Card title: "Link Your Wallet Addresses".
    - Description: Explain that this will add/update a section in their GitHub profile README.
    - Display appropriate messages for loading states, errors, and success.
    - Integrate the `WalletLinkForm.tsx` component.

### Task 3.3: Create Wallet Link Form Component (`src/components/WalletLinkForm.tsx`) - DONE

1.  **Props**:
    - `initialEthAddress: string`
    - `initialSolAddress: string`
    - `onSubmit: (ethAddress: string, solAddress: string) => Promise<void>`
    - `isProcessing: boolean`
2.  **State**: Local state for `ethAddress` and `solAddress`, initialized with props.
3.  **UI**:
    - Use shadcn `Input` fields for Ethereum and Solana addresses, with appropriate `Label`s.
    - Include placeholders like `0x...` for ETH and `your solana address` or similar for SOL.
    - Use shadcn `Button` for submission, showing a loading state (`Loader2` icon) when `isProcessing` is true.
    - Consider adding brief validation hints or icons for address formats (optional, can be a later enhancement).

## Phase 4: Styling, Refinements, and Security Review

Final touches, ensuring the feature is robust, user-friendly, and secure.

### Task 4.1: Apply Styling

1.  **Method**: Primarily use Tailwind CSS utility classes for layout and specific styling needs.
2.  **Consistency**: Ensure the new components and pages align with the existing application's design language, leveraging shadcn/ui's theming.
3.  **Responsiveness**: Verify that all new UI elements are responsive across different screen sizes.

### Task 4.2: Review and Refine Error Handling

1.  **User Experience**: Ensure all potential errors (network issues, API errors from GitHub or the worker, invalid token, insufficient scope, issues parsing/updating README) are caught and presented to the user in a clear, non-technical way.
2.  **Logging**: Implement client-side logging.
3.  **States**: Thoroughly test loading states.

### Task 4.3: Security Review

1.  **CSRF**: Confirm the `state` parameter mechanism is correctly implemented and verified in `AuthContext.handleAuthCallback` before calling the worker.
2.  **Token Handling**:
    - Re-evaluate `localStorage` for token storage. While common, be aware of XSS risks. Ensure other parts of the application are secure against XSS.
    - Ensure tokens are not leaked (e.g., in URLs unnecessarily, or in error messages).
3.  **Cloudflare Worker**:
    - Double-check that `ALLOWED_ORIGIN` in the worker is strictly set to the production Next.js app's domain.
    - Ensure production secrets are used, not hardcoded values.
4.  **OAuth Scopes**:
    - Confirm only necessary scopes (`read:user`, `public_repo`) are requested.
    - Clearly communicate to the user why these permissions are needed.
    - Verify the Cloudflare Worker and Next.js client correctly check for the `public_repo` scope in the token response.
5.  **HTTPS**: Ensure all communications (Next.js app, Cloudflare Worker, GitHub API) occur over HTTPS.

### Task 4.4: Testing

1.  **End-to-End Flow**:
    - Login successfully.
    - Logout.
    - Attempt to access `/profile/edit` without login (should redirect).
    - **Link Wallets (New User/No README section)**:
      - User has no existing profile README or no wallet section.
      - Action: User enters ETH and/or SOL addresses and saves.
      - Expected: Profile repo created (if needed), README.md created/updated with the new wallet section appended.
    - **Link Wallets (Existing README section)**:
      - User has an existing wallet section from this app.
      - Action: User updates one or both addresses and saves.
      - Expected: Wallet section in README.md is updated; other README content remains untouched.
    - **Link Wallets (Existing README, no wallet section)**:
      - User has an existing README.md with other content.
      - Action: User enters ETH and/or SOL addresses and saves.
      - Expected: New wallet section is appended to README.md; existing content is preserved.
    - Clearing an address should update the README to reflect "Not set" or remove the line.
2.  **Edge Cases**:
    - GitHub token revocation/expiry.
    - GitHub API rate limits.
    - Network interruptions.
    - Incorrect `state` parameter.
    - Token missing `public_repo` scope.
    - README content that might conflict with parsing logic (e.g., user manually creating similar HTML comments).
3.  **Browser Compatibility**: Test on major browsers.
