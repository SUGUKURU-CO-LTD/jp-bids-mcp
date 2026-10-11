import { z } from "zod";

export const PrefectureNameSchema = z.enum([
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
]);

export type PrefectureName = z.infer<typeof PrefectureNameSchema>;

export const prefectureEntries: ReadonlyArray<{
  code: string;
  name: PrefectureName;
}> = [
  { code: "01", name: "北海道" },
  { code: "02", name: "青森県" },
  { code: "03", name: "岩手県" },
  { code: "04", name: "宮城県" },
  { code: "05", name: "秋田県" },
  { code: "06", name: "山形県" },
  { code: "07", name: "福島県" },
  { code: "08", name: "茨城県" },
  { code: "09", name: "栃木県" },
  { code: "10", name: "群馬県" },
  { code: "11", name: "埼玉県" },
  { code: "12", name: "千葉県" },
  { code: "13", name: "東京都" },
  { code: "14", name: "神奈川県" },
  { code: "15", name: "新潟県" },
  { code: "16", name: "富山県" },
  { code: "17", name: "石川県" },
  { code: "18", name: "福井県" },
  { code: "19", name: "山梨県" },
  { code: "20", name: "長野県" },
  { code: "21", name: "岐阜県" },
  { code: "22", name: "静岡県" },
  { code: "23", name: "愛知県" },
  { code: "24", name: "三重県" },
  { code: "25", name: "滋賀県" },
  { code: "26", name: "京都府" },
  { code: "27", name: "大阪府" },
  { code: "28", name: "兵庫県" },
  { code: "29", name: "奈良県" },
  { code: "30", name: "和歌山県" },
  { code: "31", name: "鳥取県" },
  { code: "32", name: "島根県" },
  { code: "33", name: "岡山県" },
  { code: "34", name: "広島県" },
  { code: "35", name: "山口県" },
  { code: "36", name: "徳島県" },
  { code: "37", name: "香川県" },
  { code: "38", name: "愛媛県" },
  { code: "39", name: "高知県" },
  { code: "40", name: "福岡県" },
  { code: "41", name: "佐賀県" },
  { code: "42", name: "長崎県" },
  { code: "43", name: "熊本県" },
  { code: "44", name: "大分県" },
  { code: "45", name: "宮崎県" },
  { code: "46", name: "鹿児島県" },
  { code: "47", name: "沖縄県" },
];

export const prefectureNameToCode = new Map(
  prefectureEntries.map((entry) => [entry.name, entry.code]),
);
export const prefectureCodeToName = new Map(
  prefectureEntries.map((entry) => [entry.code, entry.name]),
);

export function toLgCode(prefectures: PrefectureName | PrefectureName[]): string {
  const names = Array.isArray(prefectures) ? prefectures : [prefectures];
  const codes = names.map((name) => prefectureNameToCode.get(name));
  if (codes.some((code) => code === undefined)) {
    throw new Error(`Unknown prefecture: ${names.join(", ")}`);
  }
  return codes.join(",");
}
