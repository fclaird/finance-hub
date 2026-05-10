import { notFound } from "next/navigation";

import { StrategyCategoryPage } from "@/app/components/strategy/StrategyCategoryPage";
import { isStrategyTabSlug } from "@/lib/strategy/strategyCategories";

type PageProps = {
  params: Promise<{ category: string }>;
};

export default async function StrategyCategoryRoutePage({ params }: PageProps) {
  const { category } = await params;
  if (!isStrategyTabSlug(category)) notFound();

  return (
    <div className="flex w-full max-w-6xl flex-1 flex-col gap-6 py-8 pl-4 pr-6">
      <StrategyCategoryPage category={category} />
    </div>
  );
}
