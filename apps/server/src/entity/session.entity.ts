import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { SessionState } from '@spark_coder/shared';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * QR / initial pairing token (single-use context).
   * Used during first-time pairing flow.
   */
  @Column({ type: 'varchar', unique: true, length: 64 })
  token!: string;

  /** Desktop device online status */
  @Column({ type: 'varchar', length: 16, default: 'offline', name: 'desktop_status' })
  desktopStatus!: 'online' | 'offline';

  /** Mobile device online status */
  @Column({ type: 'varchar', length: 16, default: 'offline', name: 'mobile_status' })
  mobileStatus!: 'online' | 'offline';

  /** Desktop physical fingerprint */
  @Column({ type: 'varchar', nullable: true, length: 128, name: 'desktop_device_id' })
  desktopDeviceId!: string | null;

  /** Mobile physical device ID */
  @Column({ type: 'varchar', nullable: true, length: 128, name: 'mobile_device_id' })
  mobileDeviceId!: string | null;

  /** 'claude' | future CLI types */
  @Column({ type: 'varchar', length: 32, default: 'claude', name: 'launch_type' })
  launchType!: string;

  @Column({ type: 'varchar', default: SessionState.WAITING_FOR_AGENT, length: 32 })
  state!: SessionState;

  // ── Ephemeral socket IDs (reset on each (re)connection) ──────────────────

  @Column({ type: 'varchar', nullable: true, name: 'agent_socket_id', length: 128 })
  agentSocketId!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'mobile_socket_id', length: 128 })
  mobileSocketId!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'agent_platform', length: 32 })
  agentPlatform!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'mobile_platform', length: 32 })
  mobilePlatform!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'agent_hostname', length: 128 })
  agentHostname!: string | null;

  @Column({ type: 'datetime', nullable: true, name: 'paired_at' })
  pairedAt!: Date | null;

  @Column({ type: 'datetime', name: 'last_activity_at' })
  lastActivityAt!: Date;

  /**
   * Unpaired sessions expire after 24h.
   */
  @Column({ type: 'datetime', nullable: true, name: 'expires_at' })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
