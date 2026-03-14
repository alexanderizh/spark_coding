import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { SessionState } from '@remote-claude/shared';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true, length: 64 })
  token!: string;

  @Column({ type: 'varchar', default: SessionState.WAITING_FOR_AGENT, length: 32 })
  state!: SessionState;

  @Column({ type: 'varchar', nullable: true, name: 'agent_socket_id', length: 128 })
  agentSocketId!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'mobile_socket_id', length: 128 })
  mobileSocketId!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'agent_platform', length: 32 })
  agentPlatform!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'mobile_device_id', length: 128 })
  mobileDeviceId!: string | null;

  @Column({ type: 'datetime', nullable: true, name: 'paired_at' })
  pairedAt!: Date | null;

  @Column({ type: 'datetime', name: 'last_activity_at' })
  lastActivityAt!: Date;

  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
