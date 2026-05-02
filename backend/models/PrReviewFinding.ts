import mongoose, { Schema, Document } from 'mongoose';

export interface IPrReviewFinding extends Document {
    repoFullName: string;
    prNumber: number;
    category: string;
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    linesAffected?: number;
    description: string;
}

const PrReviewFindingSchema = new Schema<IPrReviewFinding>(
    {
        repoFullName: { type: String, required: true, index: true },
        prNumber: { type: Number, required: true, index: true },
        category: { type: String, required: true },
        filePath: { type: String, required: true },
        lineStart: { type: Number, required: false },
        lineEnd: { type: Number, required: false },
        linesAffected: { type: Number, required: false },
        description: { type: String, required: true },
    },
    {
        timestamps: true,
    },
);

PrReviewFindingSchema.index({ repoFullName: 1, prNumber: 1, createdAt: -1 });

export default mongoose.model<IPrReviewFinding>('PrReviewFinding', PrReviewFindingSchema);
