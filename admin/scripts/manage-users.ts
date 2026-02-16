import { PrismaClient } from '@prisma/client';
import inquirer from 'inquirer';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Welcome to the Admin User Manager');

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'rawlist',
        name: 'action',
        message: 'Select an action:',
        choices: [
          'List Users',
          'Add User',
          'Delete User',
          'Change Password',
          'Exit'
        ],
      },
    ]);

    if (action === 'Exit') {
      break;
    }

    if (action === 'List Users') {
      try {
        const users = await prisma.user.findMany({
          orderBy: { createdAt: 'desc' }
        });
        if (users.length === 0) {
          console.log('\nNo users found.\n');
        } else {
          console.table(users.map(u => ({
            ID: u.id, 
            Username: u.username, 
            Created: u.createdAt.toLocaleString() 
          })));
        }
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    } 
    
    else if (action === 'Add User') {
      const { username, password } = await inquirer.prompt([
        {
          type: 'input',
          name: 'username',
          message: 'Enter username:',
          validate: (input) => input.length > 0 || 'Username cannot be empty',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Enter password:',
          mask: '*',
          validate: (input) => input.length >= 4 || 'Password must be at least 4 characters',
        },
      ]);

      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
          data: {
            username,
            password: hashedPassword,
          },
        });
        console.log(`\n✅ User '${user.username}' created successfully.\n`);
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((error as any).code === 'P2002') {
          console.log('\n❌ Error: Username already exists.\n');
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          console.error('\n❌ Error creating user:', (error as any).message);
        }
      }
    } 
    
    else if (action === 'Delete User') {
      const users = await prisma.user.findMany();
      if (users.length === 0) {
        console.log('\nNo users to delete.\n');
        continue;
      }

      const { userId } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'userId',
          message: 'Select user to delete:',
          choices: [
            ...users.map(u => ({ name: u.username, value: u.id })),
            new inquirer.Separator(),
            { name: 'Cancel', value: null }
          ],
        },
      ]);

      if (userId) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to delete this user?',
            default: false,
          },
        ]);

        if (confirm) {
          try {
            await prisma.user.delete({ where: { id: userId } });
            console.log('\n✅ User deleted successfully.\n');
          } catch (error) {
            console.error('\n❌ Error deleting user:', error);
          }
        } else {
          console.log('\n❌ Deletion cancelled.\n');
        }
      }
    }

    else if (action === 'Change Password') {
      const users = await prisma.user.findMany();
      if (users.length === 0) {
        console.log('\nNo users found.\n');
        continue;
      }

      const { userId } = await inquirer.prompt([
        {
          type: 'rawlist',
          name: 'userId',
          message: 'Select user to change password:',
          choices: [
            ...users.map(u => ({ name: u.username, value: u.id })),
            new inquirer.Separator(),
            { name: 'Cancel', value: null }
          ],
        },
      ]);

      if (userId) {
        const { newPassword } = await inquirer.prompt([
          {
            type: 'password',
            name: 'newPassword',
            message: 'Enter new password:',
            mask: '*',
            validate: (input) => input.length >= 4 || 'Password must be at least 4 characters',
          },
        ]);

        try {
          const hashedPassword = await bcrypt.hash(newPassword, 10);
          await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
          });
          console.log('\n✅ Password updated successfully.\n');
        } catch (error) {
          console.error('\n❌ Error updating password:', error);
        }
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});