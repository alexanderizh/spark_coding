import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type VersionType = 'app' | 'desktop';
export type AppPlatform = 'android';
export type DesktopPlatform = 'macos' | 'windows';
export type VersionPlatform = AppPlatform | DesktopPlatform;

@Entity('versions')
export class Version {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 版本类型：app / desktop */
  @Column({ type: 'varchar', length: 16 })
  type!: VersionType;

  /** 版本号，如 1.0.0 */
  @Column({ type: 'varchar', length: 32 })
  version!: string;

  /** 平台：android / macos / windows */
  @Column({ type: 'varchar', length: 16 })
  platform!: VersionPlatform;

  /** 下载链接 */
  @Column({ type: 'varchar', length: 512, name: 'download_url' })
  downloadUrl!: string;

  /** 发布说明 */
  @Column({ type: 'text', nullable: true, name: 'release_notes' })
  releaseNotes!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
