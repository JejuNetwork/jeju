"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { UserActivityHeatmap } from "@/lib/scoring/queries";

// Define the shape of our chart data
interface ChartDataItem {
  date: string;
  day: string;
  prScore: number;
  issueScore: number;
  reviewScore: number;
  commentScore: number;
  total: number;
  isEmpty: boolean;
}

export const DailyActivity = ({ data }: { data?: UserActivityHeatmap[] }) => {
  if (!data || data.length === 0) {
    return null;
  }

  // Get the most recent days of activity (up to 31 days)
  const recentActivity = data.slice(-31);

  // Define chart config
  const chartConfig: ChartConfig = {
    prScore: {
      label: "PRs",
      color: "hsl(var(--chart-4))",
    },
    issueScore: {
      label: "Issues",
      color: "hsl(var(--chart-3))",
    },
    reviewScore: {
      label: "Reviews",
      color: "hsl(var(--chart-1))",
    },
    commentScore: {
      label: "Comments",
      color: "hsl(var(--chart-2))",
    },
  };

  // Transform data for recharts
  const chartData: ChartDataItem[] = recentActivity.map((day) => {
    const prScore = day.metrics?.pullRequests.total || 0;
    const issueScore = day.metrics?.issues.total || 0;
    const reviewScore = day.metrics?.reviews.total || 0;
    const commentScore =
      (day.metrics?.comments.issues || 0) +
      (day.metrics?.comments.pullRequests || 0);

    const total = prScore + issueScore + reviewScore + commentScore;

    return {
      date: day.date,
      day: day.date.slice(-2),
      prScore,
      issueScore,
      reviewScore,
      commentScore,
      total,
      isEmpty: total === 0,
    };
  });

  return (
    <Card>
      <CardHeader className="p-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Recent Activity (Last {recentActivity.length} Days)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {chartData.every((day) => day.isEmpty) ? (
          <div className="flex h-[200px] w-full items-center justify-center text-muted-foreground">
            No activity data for the selected period
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart
              accessibilityLayer
              data={chartData}
              margin={{ top: 20, right: 10, left: -30, bottom: 10 }}
              barGap={1}
              barSize={8}
            >
              <defs>
                <linearGradient id="colorPR" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-prScore)"
                    stopOpacity={1}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-prScore)"
                    stopOpacity={0.8}
                  />
                </linearGradient>
                <linearGradient id="colorIssue" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-issueScore)"
                    stopOpacity={1}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-issueScore)"
                    stopOpacity={0.8}
                  />
                </linearGradient>
                <linearGradient id="colorReview" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-reviewScore)"
                    stopOpacity={1}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-reviewScore)"
                    stopOpacity={0.8}
                  />
                </linearGradient>
                <linearGradient id="colorComment" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-commentScore)"
                    stopOpacity={1}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-commentScore)"
                    stopOpacity={0.8}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid opacity={1} vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickMargin={0}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent labelKey="date" indicator="dot" />
                }
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <ChartLegend
                content={
                  <ChartLegendContent className="text-muted-foreground" />
                }
                layout="horizontal"
                // verticalAlign="top"
              />
              <Bar
                dataKey="prScore"
                stackId="a"
                fill="var(--color-prScore)"
                radius={[0, 0, 0, 0]}
                animationDuration={300}
              />
              <Bar
                dataKey="issueScore"
                stackId="a"
                fill="var(--color-issueScore)"
                radius={[0, 0, 0, 0]}
                animationDuration={300}
                animationBegin={75}
              />
              <Bar
                dataKey="reviewScore"
                stackId="a"
                fill="var(--color-reviewScore)"
                radius={[0, 0, 0, 0]}
                animationDuration={300}
                animationBegin={150}
              />
              <Bar
                dataKey="commentScore"
                stackId="a"
                fill="var(--color-commentScore)"
                radius={[0, 0, 0, 0]}
                animationDuration={500}
                animationBegin={225}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
};
