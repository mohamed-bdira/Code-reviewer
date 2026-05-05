import mongoose, { Schema, Document } from 'mongoose';

export interface IPrReviewFinding extends Document {
    dedupeKey?: string;
    repoFullName: string;
    prNumber: number;
    category: string;
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    linesAffected?: number;
    description: string;
    firstSeenAt?: Date;
    lastSeenAt?: Date;
}

const PrReviewFindingSchema = new Schema<IPrReviewFinding>(
    {
        dedupeKey: { type: String, required: false },
        repoFullName: { type: String, required: true },
        prNumber: { type: Number, required: true },
        category: { type: String, required: true },
        filePath: { type: String, required: true },
        lineStart: { type: Number, required: false },
        lineEnd: { type: Number, required: false },
        linesAffected: { type: Number, required: false },
        description: { type: String, required: true },
        firstSeenAt: { type: Date, required: false },
        lastSeenAt: { type: Date, required: false },
    },
    {
        timestamps: true,
    },
);

PrReviewFindingSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
PrReviewFindingSchema.index({ repoFullName: 1, prNumber: 1, lastSeenAt: -1 });
PrReviewFindingSchema.index({ category: 1 });

export default mongoose.model<IPrReviewFinding>('PrReviewFinding', PrReviewFindingSchema);
