"use client";

type Props = {
  baselineGrade: string;
  optimizedGrade: string;
};

// Traffic-light color per IMO CII grade: A/B green, C yellow, D orange, E red.
const GRADE_COLORS: Record<string, string> = {
  A: "#16a34a",
  B: "#16a34a",
  C: "#eab308",
  D: "#f97316",
  E: "#dc2626",
};

// Grade A (best) = 0 ... E (worst) = 4, so we can count how many steps improved.
const GRADE_ORDER = ["A", "B", "C", "D", "E"];

// Turkish number words for the realistic grade-step range (max E -> A = 4).
const TR_NUMBERS: Record<number, string> = {
  1: "bir",
  2: "iki",
  3: "üç",
  4: "dört",
};

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? "#6b7280";
}

function GradeBox({ grade }: { grade: string }) {
  return (
    <div
      className="w-16 h-16 rounded flex items-center justify-center text-white text-2xl font-bold"
      style={{ backgroundColor: gradeColor(grade) }}
    >
      {grade}
    </div>
  );
}

/**
 * Visual CII grade jump: two traffic-light colored boxes (baseline -> optimized)
 * with an arrow between them, and a Turkish caption describing how many grade
 * steps the voyage improved.
 */
export default function CiiBadge({ baselineGrade, optimizedGrade }: Props) {
  const steps =
    GRADE_ORDER.indexOf(baselineGrade) - GRADE_ORDER.indexOf(optimizedGrade);
  const improved = steps > 0;
  const stepWord = TR_NUMBERS[steps] ?? String(steps);
  const caption = improved
    ? `CII Notu: ${baselineGrade} → ${optimizedGrade} (${stepWord} kademe iyileşme)`
    : `CII Notu: ${baselineGrade} → ${optimizedGrade}`;

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-2">CII Notu Değişimi</h2>
      <div className="flex items-center gap-4">
        <GradeBox grade={baselineGrade} />
        <span className="text-3xl text-gray-500">→</span>
        <GradeBox grade={optimizedGrade} />
      </div>
      <p className="text-sm text-gray-700 mt-3">{caption}</p>
    </div>
  );
}
