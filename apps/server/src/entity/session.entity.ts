import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { SessionState } from '@remote-claude/shared';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 64 })
  token: string;

  @Column({ default: SessionState.WAITING_FOR_AGENT })
  state: SessionState;

  @Column({ nullable: true, name: 'agent_socket_id', length: 128 })
  agentSocketId: string | null;

  @Column({ nullable: true, name: 'mobile_socket_id', length: 128 })
  mobileSocketId: string | null;

  @Column({ nullable: true, name: 'agent_platform', length: 32 })
  agentPlatform: string | null;

  @Column({ nullable: true, name: 'mobile_device_id', length: 128 })
  mobileDeviceId: string | null;

  @Column({ nullable: true, name: 'paired_at', type: 'datetime' })
  pairedAt: Date | null;

  @Column({ name: 'last_activity_at', type: 'datetime' })
  lastActivityAt: Date;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
