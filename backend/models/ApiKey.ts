import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IApiKey extends Document {
    userId: Types.ObjectId;
    name: string;
    prefix: string;
    keyHash: string;
    lastUsedAt?: Date;
    revokedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        name: { type: String, required: true },
        prefix: { type: String, required: true, index: true },
        keyHash: { type: String, required: true },
        lastUsedAt: { type: Date, required: false },
        revokedAt: { type: Date, required: false },
    },
    { timestamps: true },
);

ApiKeySchema.index({ userId: 1, revokedAt: 1 });

export default mongoose.model<IApiKey>('ApiKey', ApiKeySchema);
