import UserProfile from "@/app/profile/[username]/components/UserProfile";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserProfile, getAllUsernames } from "./queries";

type ProfilePageProps = {
  params: Promise<{ username: string }>;
};

export async function generateStaticParams() {
  // During build time, the database may not be available
  // Return empty array to skip static generation and use ISR instead
  try {
    const maxUsers = process.env.CI_MAX_USERS
      ? parseInt(process.env.CI_MAX_USERS, 10)
      : undefined;

    const allUsers = await getAllUsernames(maxUsers);
    return allUsers.map((user) => ({
      username: user.username,
    }));
  } catch {
    // Database not available during build - use ISR for all profiles
    return [];
  }
}

export async function generateMetadata({
  params,
}: ProfilePageProps): Promise<Metadata> {
  const { username } = await params;
  const userData = await getUserProfile(username);

  // Get the latest weekly summary for meta description if available
  const description =
    userData?.weeklySummaries && userData.weeklySummaries.length > 0
      ? userData.weeklySummaries[0].summary || "Jeju Network contributor profile"
      : "Jeju Network contributor profile";

  return {
    title: userData ? `${userData.username}` : "Profile Not Found",
    description,
  };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  const userData = await getUserProfile(username);

  if (!userData) {
    notFound();
  }

  return (
    <main className="container mx-auto p-4">
      <UserProfile {...userData} />
    </main>
  );
}
