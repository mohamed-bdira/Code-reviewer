import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRepoConfig extends Document {
    userId: Types.ObjectId;
    installationId: string;
    repoFullName: string;
    focusAreas: string[];
    enforcementLevel: 'warning' | 'error';
    useAstGrep: boolean;
    customRules: string;
    mergeMinScore: number;
    createdAt: Date;
    updatedAt: Date;
}

const RepoConfigSchema = new Schema<IRepoConfig>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        installationId: { type: String, required: true },
        repoFullName: { type: String, required: true },
        focusAreas: { type: [String], default: ['security', 'style'] },
        enforcementLevel: { type: String, enum: ['warning', 'error'], default: 'warning' },
        useAstGrep: { type: Boolean, default: false },
        customRules: { type: String, default: 'Ensure standard REST principles are followed.' },
        mergeMinScore: { type: Number, default: 70, min: 0, max: 100 },
    },
    {
        timestamps: true,
    },
);

RepoConfigSchema.index({ userId: 1, repoFullName: 1 }, { unique: true });
RepoConfigSchema.index({ installationId: 1, repoFullName: 1 });

export default mongoose.model<IRepoConfig>('RepoConfig', RepoConfigSchema);
