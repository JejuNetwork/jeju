# Frontend Development Standards for UI Components

This document outlines the standards for creating shared UI components, focusing on structure, styling, and accessibility.

## Component Organization

- **Shared UI Components:**

  - Place in `src/components` directory.
  - These should be pure UI/layout components without business logic.
  - Example locations:

    ```typescript
    // ✅ DO: Place reusable UI components in src/components
    src / components / stat - card.tsx;
    src / components / activity - item.tsx;

    // ❌ DON'T: Place page-specific components here
    src / components / leaderboard - page - filters.tsx; // Should be in src/app/leaderboard/
    ```

- **Shadcn Components:**
  - All shadcn/ui base components should be placed in `src/components/ui`.
  - Do not modify these files unless extending the component API.
  - Example:
    ```typescript
    // ✅ DO: Keep shadcn components in the ui directory
    src / components / ui / button.tsx;
    src / components / ui / card.tsx;
    ```

## Component Structure

- **One Component Per File:**

  - Each file should export exactly one main component.
  - Use named exports for components.
  - Exception: compound components can be in the same file.
  - Example:

    ```typescript
    // ✅ DO: One main component per file with a named export
    export function StatCard({ title, value, icon }: StatCardProps) {
      // Implementation
    }

    // ✅ DO: Compound components can share a file
    function Tabs({ children, ...props }: TabsProps) {
      // Implementation
    }

    function TabsList({ children }: TabsListProps) {
      // Implementation
    }

    // Export as a namespace
    export { Tabs, TabsList, TabsContent, TabsTrigger };
    ```

- **File Naming Conventions:**

  - Use `kebab-case` for all new component filenames.
  - ✅ **DO**: `user-profile-card.tsx`
  - ❌ **DON'T**: `UserProfileCard.tsx`

- **Type-Only Imports:**
  - To prevent bundling unnecessary modules in the client, always use type-only imports when importing types.
  - ✅ **DO**: `import type { User } from '@/lib/types';`
  - ❌ **DON'T**: `import { User } from '@/lib/types';`

## CSS and Styling

- **Tailwind Classes:**

  - Use Tailwind's utility classes for styling.
  - Group related classes together for readability.

- **Responsiveness is Mandatory:**

  - All components and layouts MUST be responsive and work well on all screen sizes. Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`, etc.).

- **Color Palette:**

  - Avoid using `indigo` or `blue` color palettes unless explicitly requested.
  - When configuring `tailwind.config.js`, hardcode color values directly in the config file rather than using CSS variables in `globals.css`.

- **Background Color:**
  - Assume a default white background for components. If a different background is needed, apply a background color class (e.g., `bg-slate-900`) to a wrapping `div`.

## Icons

- **Use `lucide-react` for Icons:**
  - Exclusively use icons from the `lucide-react` package. Do not use inline `<svg>` elements or import `.svg` files for icons.
  - ✅ **DO**: `import { Mail } from 'lucide-react'; <Mail className="h-4 w-4" />`
  - ❌ **DON'T**: `<svg>...</svg>`

## Images & Media

- **Placeholder Images:**

  - Use the `/placeholder.svg` utility for placeholders and hardcode the `query` parameter in the URL.
  - ✅ **DO**: `<img src="/placeholder.svg?width=400&height=300&query=abstract-hero-image" />`

- **Images on `<canvas>`:**
  - When loading images programmatically for use in a `<canvas>` element, set `crossOrigin` to `"anonymous"` to avoid CORS issues.
  - ✅ **DO**:
    ```javascript
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = "/path/to/image.png";
    ```

## Component Composition

- **Composition Over Props:**

  - Prefer component composition over complex prop configurations.
  - Use `children` and render props patterns for flexibility.
  - Example:

    ```tsx
    // ✅ DO: Use composition for flexible components
    <Card>
      <CardHeader>
        <CardTitle>User Statistics</CardTitle>
        <CardDescription>Performance metrics for the current period</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Content */}
      </CardContent>
      <CardFooter>
        <Button>View Details</Button>
      </CardFooter>
    </Card>

    // ❌ DON'T: Create inflexible components with too many props
    <StatisticsCard
      title="User Statistics"
      description="Performance metrics for the current period"
      metrics={userMetrics}
      showViewDetails={true}
      onViewDetails={handleViewDetails}
    />
    ```

## Performance Optimization

- **Component Memoization:**
  - Memoize expensive pure UI components with `React.memo` to prevent unnecessary re-renders.
  - Example:
    ```tsx
    // ✅ DO: Memoize expensive components that are pure
    const MemoizedIcon = React.memo(IconComponent);
    ```

## Accessibility

- **Semantic HTML:**

  - Use appropriate semantic HTML elements.
  - Implement proper heading hierarchy (h1, h2, h3).
  - Example:
    ```tsx
    // ✅ DO: Use semantic HTML
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="text-2xl font-bold">
        User Profile
      </h2>
      <div role="list" className="mt-4 space-y-3">
        {stats.map((stat) => (
          <div role="listitem" key={stat.id}>
            {/* Stat content */}
          </div>
        ))}
      </div>
    </section>
    ```

- **Screen Reader Text:**

  - Use the `"sr-only"` Tailwind CSS class to provide context for screen readers without visually displaying the text.
  - ✅ **DO**: `<span className="sr-only">Open main menu</span>`

- **Image Alt Text:**

  - Provide descriptive `alt` text for all images. If an image is purely decorative, you can leave the `alt` text empty (`alt=""`).

- **Focus Management:**
  - Ensure keyboard navigation works properly.
  - Use proper focus indicators.
  - Example:
    ```tsx
    // ✅ DO: Ensure proper focus management
    <button
      className="rounded-md bg-primary px-4 py-2 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      onClick={handleAction}
    >
      Action Button
    </button>
    ```

## Code Formatting

- **JSX Special Characters:**
  - When displaying text content in JSX that contains special characters like `<`, `>`, `{`, or `}`, wrap it in a string literal within an expression to ensure it's escaped correctly.
  - ✅ **DO**: `<div>{'Rendered text with < and > symbols'}</div>`
  - ❌ **DON'T**: `<div>Rendered text with < and > symbols</div>`
