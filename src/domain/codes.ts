import { z } from "zod";

export const CategorySchema = z.enum(["物品", "工事", "役務"]);
export type Category = z.infer<typeof CategorySchema>;

export const ProcedureTypeSchema = z.enum([
  "一般競争入札",
  "簡易公募型競争入札",
  "簡易公募型指名競争入札",
]);
export type ProcedureType = z.infer<typeof ProcedureTypeSchema>;

export const CertificationSchema = z.enum(["A", "B", "C", "D"]);
export type Certification = z.infer<typeof CertificationSchema>;

export const categoryCodes: Record<Category, 1 | 2 | 3> = {
  物品: 1,
  工事: 2,
  役務: 3,
};

export const procedureTypeCodes: Record<ProcedureType, 1 | 2 | 3> = {
  一般競争入札: 1,
  簡易公募型競争入札: 2,
  簡易公募型指名競争入札: 3,
};
