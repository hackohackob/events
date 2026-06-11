import client from "./client";

export interface FieldGuideCase {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  summary: string;
  signs: string[];
  actions: string[];
  redFlags: string[];
  updatedAt: string;
}

export type FieldGuideCaseInput = Omit<FieldGuideCase, "id" | "updatedAt">;

export async function listFieldGuide(): Promise<FieldGuideCase[]> {
  const res = await client.get<FieldGuideCase[]>("/field-guide");
  return res.data;
}

export async function createFieldGuideCase(input: FieldGuideCaseInput): Promise<FieldGuideCase> {
  const res = await client.post<FieldGuideCase>("/field-guide", input);
  return res.data;
}

export async function updateFieldGuideCase(id: string, input: FieldGuideCaseInput): Promise<FieldGuideCase> {
  const res = await client.put<FieldGuideCase>(`/field-guide/${id}`, input);
  return res.data;
}

export async function deleteFieldGuideCase(id: string): Promise<void> {
  await client.delete(`/field-guide/${id}`);
}
