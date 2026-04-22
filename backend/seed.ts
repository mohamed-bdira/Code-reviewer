/// <reference types="node" />

import 'dotenv/config';
import {PrismaClient} from './node_modules/.prisma/client/default';
import {PrismaPg} from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({connectionString});
const prisma = new PrismaClient({adapter});

async function main (){
    console.log('Seeeding database..');

    //Create a user and automaticall ycreate a repo, PR, and reviews linked to them
    const dummyData = await prisma.user.upsert({
        where: {
            githubId: 99991111,
        },
        update: {
            username: 'person',
            email: 'person@place.com',
        },
        create:{
            githubId: 99991111,
            username: 'person',
            email: 'person@place.com',
            repositories: {
                create: {
                    githubRepoId: 88884444,
                    name: 'test',
                    owner: 'person',
                    pullRequests: {
                        create:{
                            prNumber: 1,
                            title:'feat: Add secure login',
                            status: 'open',
                            reviews: {
                                create:[
                                    {
                                        filename: 'src/login.ts',
                                        aiComment: 'No critical issues found. Good use of bcrypt.',
                                    },
                                    {
                                        filename: 'src/database.ts',
                                        aiComment: '**Critical vulnerability:** Hardcoded database Credentials.'
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        },
    });
    console.log('Dummy data successfully created.')
    console.log(dummyData)
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });