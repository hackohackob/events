import client from "./client";
import type { User } from "@/lib/types";

export interface CreateUserPayload {
  name: string;
  email: string;
  phone?: string;
  role: User["role"];
  unit: string;
  status: "active" | "inactive";
}

export async function fetchUsers(): Promise<User[]> {
  const res = await client.get("/users");
  return res.data as User[];
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const res = await client.post("/users", payload);
  return res.data as User;
}

export async function updateUser(
  id: string,
  payload: Partial<CreateUserPayload>,
): Promise<User> {
  const res = await client.put(`/users/${id}`, payload);
  return res.data as User;
}

export async function deleteUser(id: string): Promise<void> {
  await client.delete(`/users/${id}`);
}
