const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debt')
        .setDescription('Check chef debt information')
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check debt for a specific chef or yourself')
                .addUserOption(option =>
                    option.setName('chef')
                        .setDescription('Chef to check debt for (leave blank for yourself)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('all')
                .setDescription('View all chef debts (Admin only)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear a chef\'s debt (Admin only)')
                .addUserOption(option =>
                    option.setName('chef')
                        .setDescription('Chef to clear debt for')
                        .setRequired(true))),
    
    async execute(interaction, client, db) {
        const subcommand = interaction.options.getSubcommand();
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        if (subcommand === 'check') {
            const targetUser = interaction.options.getUser('chef') || interaction.user;
            
            // Check if user can view this debt
            if (targetUser.id !== interaction.user.id && !hasAdminRole && !isAdmin) {
                return interaction.reply({ 
                    content: 'You can only check your own debt unless you have admin permissions!', 
                    ephemeral: true 
                });
            }
            
            try {
                const chefData = await db.getChefDebt(targetUser.id);
                
                if (!chefData) {
                    return interaction.reply({ 
                        content: `${targetUser.id === interaction.user.id ? 'You are' : 'This user is'} not registered as a chef!`, 
                        ephemeral: true 
                    });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(`💳 Debt Information - ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL())
                    .setColor('#FFA500')
                    .addFields(
                        { name: '💰 Current Debt', value: `$${chefData.debt_amount.toFixed(2)}`, inline: true },
                        { name: '📦 Total Orders', value: `${chefData.total_completed}`, inline: true },
                        { name: '📊 Status', value: chefData.status, inline: true },
                        { name: '💵 Average per Order', value: chefData.total_completed > 0 ? `$${(chefData.debt_amount / chefData.total_completed).toFixed(2)}` : '$0.00', inline: true }
                    )
                    .setFooter({ text: 'Contact admin to clear debt' })
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed], ephemeral: targetUser.id !== interaction.user.id });
                
            } catch (error) {
                console.error('Error checking debt:', error);
                await interaction.reply({ 
                    content: 'There was an error checking the debt!', 
                    ephemeral: true 
                });
            }
            
        } else if (subcommand === 'all') {
            if (!hasAdminRole && !isAdmin) {
                return interaction.reply({ 
                    content: 'You need admin permissions to view all debts!', 
                    ephemeral: true 
                });
            }
            
            try {
                const allDebts = await db.getAllDebts();
                
                if (allDebts.length === 0) {
                    return interaction.reply({ 
                        content: 'No chefs have any debt!', 
                        ephemeral: true 
                    });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('💳 All Chef Debts')
                    .setColor('#FF0000')
                    .setTimestamp();
                
                let debtList = '';
                let totalDebt = 0;
                
                for (const chef of allDebts) {
                    debtList += `<@${chef.user_id}>: **$${chef.debt_amount.toFixed(2)}** (${chef.total_completed} orders)\n`;
                    totalDebt += chef.debt_amount;
                }
                
                embed.setDescription(debtList);
                embed.addFields({ 
                    name: '💰 Total Outstanding Debt', 
                    value: `$${totalDebt.toFixed(2)}`, 
                    inline: false 
                });
                
                await interaction.reply({ embeds: [embed], ephemeral: true });
                
            } catch (error) {
                console.error('Error getting all debts:', error);
                await interaction.reply({ 
                    content: 'There was an error getting the debt information!', 
                    ephemeral: true 
                });
            }
            
        } else if (subcommand === 'clear') {
            if (!hasAdminRole && !isAdmin) {
                return interaction.reply({ 
                    content: 'You need admin permissions to clear debts!', 
                    ephemeral: true 
                });
            }
            
            const targetUser = interaction.options.getUser('chef');
            
            try {
                const chefData = await db.getChefDebt(targetUser.id);
                
                if (!chefData) {
                    return interaction.reply({ 
                        content: 'This user is not registered as a chef!', 
                        ephemeral: true 
                    });
                }
                
                if (chefData.debt_amount === 0) {
                    return interaction.reply({ 
                        content: 'This chef has no debt to clear!', 
                        ephemeral: true 
                    });
                }
                
                const clearedAmount = chefData.debt_amount;
                await db.clearChefDebt(targetUser.id);
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Debt Cleared')
                    .setDescription(`Successfully cleared **$${clearedAmount.toFixed(2)}** debt for ${targetUser}`)
                    .setColor('#00FF00')
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
                
                // Notify the chef
                try {
                    const chef = await client.users.fetch(targetUser.id);
                    const notifyEmbed = new EmbedBuilder()
                        .setTitle('💳 Debt Cleared!')
                        .setDescription(`Your debt of $${clearedAmount.toFixed(2)} has been cleared by an admin.`)
                        .setColor('#00FF00')
                        .setTimestamp();
                    
                    await chef.send({ embeds: [notifyEmbed] });
                } catch (error) {
                    console.log('Could not send DM to chef:', error.message);
                }
                
            } catch (error) {
                console.error('Error clearing debt:', error);
                await interaction.reply({ 
                    content: 'There was an error clearing the debt!', 
                    ephemeral: true 
                });
            }
        }
    },
};