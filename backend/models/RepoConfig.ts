import mongoose, { Schema, Document} from 'mongoose';

//Define the Interface
export interface IRepoConfig extends Document {
    installationId: string;
    repoFullName: string;
    focusAreas: string[];
    enforcementLevel: 'warning' | 'error';
    useAstGrep: boolean;
    customRules: string;
}

//Define the Mongoose Schema
const RepoConfigSchema: Schema = new Schema({
    installationId: {type: String, required: true},
    repoFullName: {type: String, required: true, unique: true},
    focusAreas: {type: [String], default: ['security', 'style']},
    enforcementLevel: {type: String, enum: ['warning', 'error'], default: 'warning'},
    useAstGrep: {type: Boolean, default: false},
    customRules: {type: String, default: 'Ensure standard REST principles are followed.'}
}, {
    timestamps: true //Auto adds createdat and updatedat
});

export default mongoose.model<IRepoConfig>('RepoConfig', RepoConfigSchema);