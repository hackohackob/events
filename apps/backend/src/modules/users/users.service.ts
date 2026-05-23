import { Injectable, NotFoundException } from "@nestjs/common";
import { DbService } from "../infra/db.service";
import type { CreateUserDto, UpdateUserDto } from "./dto/create-user.dto";

export interface UserRecord {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  unit: string;
  status: string;
  joined: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  async list(): Promise<UserRecord[]> {
    const res = await this.db.query<UserRecord>(
      "SELECT id, name, email, phone, role, unit, status, joined::text FROM users ORDER BY created_at DESC",
    );
    return res.rows;
  }

  async findById(id: string): Promise<UserRecord> {
    const res = await this.db.query<UserRecord>(
      "SELECT id, name, email, phone, role, unit, status, joined::text FROM users WHERE id = $1",
      [id],
    );
    if (!res.rows[0]) throw new NotFoundException(`User ${id} not found`);
    return res.rows[0];
  }

  async create(dto: CreateUserDto): Promise<UserRecord> {
    const res = await this.db.query<UserRecord>(
      `INSERT INTO users (name, email, phone, role, unit, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, role, unit, status, joined::text`,
      [dto.name, dto.email ?? null, dto.phone ?? null, dto.role ?? "paramedic", dto.unit ?? "", dto.status ?? "active"],
    );
    return res.rows[0];
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserRecord> {
    const existing = await this.findById(id);
    const res = await this.db.query<UserRecord>(
      `UPDATE users
       SET name   = $1,
           email  = $2,
           phone  = $3,
           role   = $4,
           unit   = $5,
           status = $6
       WHERE id = $7
       RETURNING id, name, email, phone, role, unit, status, joined::text`,
      [
        dto.name ?? existing.name,
        dto.email ?? existing.email ?? null,
        dto.phone ?? existing.phone ?? null,
        dto.role ?? existing.role,
        dto.unit ?? existing.unit,
        dto.status ?? existing.status,
        id,
      ],
    );
    if (!res.rows[0]) throw new NotFoundException(`User ${id} not found`);
    return res.rows[0];
  }

  async remove(id: string): Promise<void> {
    const res = await this.db.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
    if (res.rowCount === 0) throw new NotFoundException(`User ${id} not found`);
  }
}
