import {
  Code2,
  Users,
  Puzzle,
  FileText,
  Server,
  TestTube2,
  Shield,
  Layout,
  Building2,
  Wrench,
  Hammer,
  Bug,
  BookOpen,
  Eye,
  Cog,
  FileCode2,
  Blocks,
  Brain,
  Database,
  Network,
} from "lucide-react";

export const skillIcons = {
  // Area tags
  core: Code2,
  client: Users,
  plugin: Puzzle,
  docs: FileText,
  infra: Server,
  test: TestTube2,
  tests: TestTube2,
  security: Shield,
  ui: Layout,

  // Role tags
  architect: Building2,
  maintainer: Wrench,
  "feature-dev": Hammer,
  "bug-fix": Bug,
  "bug-fixer": Bug,
  "docs-writer": BookOpen,
  reviewer: Eye,
  devops: Cog,

  // Tech tags
  typescript: FileCode2,
  blockchain: Blocks,
  ai: Brain,
  db: Database,
  database: Database,
  api: Network,
} as const;

export type SkillName = keyof typeof skillIcons;
