import { Provide } from '@midwayjs/decorator';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Version, VersionType, VersionPlatform } from '../entity/version.entity';

export interface CreateVersionDto {
  type: VersionType;
  version: string;
  platform: VersionPlatform;
  downloadUrl: string;
  releaseNotes?: string;
}

export interface UpdateVersionDto {
  version?: string;
  platform?: VersionPlatform;
  downloadUrl?: string;
  releaseNotes?: string;
}

export interface ListVersionsOptions {
  type?: VersionType;
  page?: number;
  limit?: number;
}

@Provide()
export class VersionService {
  @InjectEntityModel(Version)
  versionRepo: Repository<Version>;

  async create(dto: CreateVersionDto): Promise<Version> {
    const version = this.versionRepo.create({
      type: dto.type,
      version: dto.version,
      platform: dto.platform,
      downloadUrl: dto.downloadUrl,
      releaseNotes: dto.releaseNotes ?? null,
    });
    return this.versionRepo.save(version);
  }

  async findById(id: string): Promise<Version | null> {
    return this.versionRepo.findOne({ where: { id } });
  }

  async update(id: string, dto: UpdateVersionDto): Promise<Version | null> {
    const version = await this.findById(id);
    if (!version) return null;
    Object.assign(version, dto);
    return this.versionRepo.save(version);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.versionRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async list(options: ListVersionsOptions): Promise<{ items: Version[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const qb = this.versionRepo
      .createQueryBuilder('v')
      .orderBy('v.createdAt', 'DESC');

    if (options.type) {
      qb.andWhere('v.type = :type', { type: options.type });
    }

    const [items, total] = await qb.skip(skip).take(limit).getManyAndCount();
    return { items, total };
  }
}
