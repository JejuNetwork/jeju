import { Suspense } from "react";
import { Loader2 } from "lucide-react"; // For Suspense fallback
import ProfileEditor from "./components/ProfileEditor"; // Adjusted path

export default function ProfileEditPage() {
  return (
    <Suspense
      fallback={
        // This fallback is for the client component itself if it suspends
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <ProfileEditor />
    </Suspense>
  );
}
