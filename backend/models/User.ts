import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    passwordHash?: string;
    githubId?: number;
    githubLogin?: string;
    displayName?: string;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: false },
        githubId: { type: Number, required: false },
        githubLogin: { type: String, required: false },
        displayName: { type: String, required: false },
    },
    { timestamps: true },
);

UserSchema.index({ githubId: 1 }, { unique: true, sparse: true });

export default mongoose.model<IUser>('User', UserSchema);
