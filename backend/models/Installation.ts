import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IInstallation extends Document {
    userId: Types.ObjectId;
    installationId: string;
    accountLogin: string;
    accountType: 'User' | 'Organization';
    createdAt: Date;
    updatedAt: Date;
}

const InstallationSchema = new Schema<IInstallation>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        installationId: { type: String, required: true, unique: true },
        accountLogin: { type: String, required: true },
        accountType: { type: String, enum: ['User', 'Organization'], default: 'User' },
    },
    { timestamps: true },
);

export default mongoose.model<IInstallation>('Installation', InstallationSchema);
