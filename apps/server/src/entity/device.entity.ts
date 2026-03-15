import {
  Entity, PrimaryColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/**
 * Represents a registered physical device (desktop or mobile).
 * Primary key = fingerprint (stable hardware hash or platform device ID).
 */
@Entity('devices')
export class Device {
  /** 32-char hex fingerprint (desktop) or platform device ID (mobile) */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  /** 'desktop' | 'mobile' */
  @Column({ type: 'varchar', length: 16 })
  platform!: string;

  /** Human-readable hostname (desktop only) */
  @Column({ type: 'varchar', nullable: true, length: 128 })
  hostname!: string | null;

  /** User-facing device name */
  @Column({ type: 'varchar', nullable: true, length: 128 })
  name!: string | null;

  @Column({ type: 'datetime', nullable: true, name: 'last_seen_at' })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
