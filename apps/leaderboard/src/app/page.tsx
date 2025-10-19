import { redirect } from "next/navigation";

export default function Homepage() {
  // Default to the daily view
  redirect("/summary/day");
}
