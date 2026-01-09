import * as vscode from 'vscode';

/**
 * Rating Reminder Manager
 *
 * Shows a non-intrusive reminder to rate the extension after the user
 * has had a positive experience with it.
 *
 * Strategy:
 * - Shows after 14 days of usage OR 100 feature uses (only engaged users)
 * - Shows ONLY ONCE EVER - never annoys users
 * - If user declines (clicks "Not Now" or dismisses), NEVER shows again
 * - Only action is "Rate Now" - opens marketplace
 * - Completely respects user's choice
 */

export class RatingReminderManager {
    private context: vscode.ExtensionContext;
    private readonly DAYS_BEFORE_REMINDER = 14; // 2 weeks - only show to engaged users
    private readonly FEATURE_USES_BEFORE_REMINDER = 100; // 100 uses - shows real usage
    private readonly VERSION_KEY = 'rubymate.ratingReminder.version';
    private readonly INSTALL_DATE_KEY = 'rubymate.ratingReminder.installDate';
    private readonly FEATURE_COUNT_KEY = 'rubymate.ratingReminder.featureCount';
    private readonly DISMISSED_KEY = 'rubymate.ratingReminder.dismissed';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Initialize rating reminder on extension activation
     */
    async initialize(): Promise<void> {
        // Record install date if not exists
        const installDate = this.context.globalState.get<number>(this.INSTALL_DATE_KEY);
        if (!installDate) {
            await this.context.globalState.update(this.INSTALL_DATE_KEY, Date.now());
        }

        // Initialize feature count if not exists
        const featureCount = this.context.globalState.get<number>(this.FEATURE_COUNT_KEY);
        if (featureCount === undefined) {
            await this.context.globalState.update(this.FEATURE_COUNT_KEY, 0);
        }
    }

    /**
     * Track feature usage and potentially show rating reminder
     */
    async trackFeatureUse(): Promise<void> {
        const currentCount = this.context.globalState.get<number>(this.FEATURE_COUNT_KEY, 0);
        await this.context.globalState.update(this.FEATURE_COUNT_KEY, currentCount + 1);

        // Check if we should show the reminder
        await this.checkAndShowReminder();
    }

    /**
     * Check if conditions are met to show the rating reminder
     */
    private async checkAndShowReminder(): Promise<void> {
        // Check if user dismissed it permanently
        const dismissed = this.context.globalState.get<boolean>(this.DISMISSED_KEY, false);
        if (dismissed) {
            return;
        }

        // Check if already shown for this version
        const extensionVersion = vscode.extensions.getExtension('BalajiR.rubymate')?.packageJSON.version;
        const lastShownVersion = this.context.globalState.get<string>(this.VERSION_KEY);
        if (lastShownVersion === extensionVersion) {
            return;
        }

        // Check if enough time has passed
        const installDate = this.context.globalState.get<number>(this.INSTALL_DATE_KEY, Date.now());
        const daysSinceInstall = (Date.now() - installDate) / (1000 * 60 * 60 * 24);

        // Check if enough features have been used
        const featureCount = this.context.globalState.get<number>(this.FEATURE_COUNT_KEY, 0);

        // Show reminder if either condition is met
        const shouldShow = daysSinceInstall >= this.DAYS_BEFORE_REMINDER ||
                          featureCount >= this.FEATURE_USES_BEFORE_REMINDER;

        if (shouldShow) {
            await this.showReminderNotification();
        }
    }

    /**
     * Show the rating reminder notification
     */
    private async showReminderNotification(): Promise<void> {
        const extensionVersion = vscode.extensions.getExtension('BalajiR.rubymate')?.packageJSON.version;

        const message = '⭐ Enjoying RubyMate? Your feedback helps us improve!';

        const rateNow = 'Rate Now ⭐';
        const notNow = 'Not Now';

        const choice = await vscode.window.showInformationMessage(
            message,
            rateNow,
            notNow
        );

        if (choice === rateNow) {
            // User clicked "Rate Now" - open marketplace and mark as shown
            await this.context.globalState.update(this.VERSION_KEY, extensionVersion);

            const marketplaceUrl = 'https://marketplace.visualstudio.com/items?itemName=BalajiR.rubymate&ssr=false#review-details';
            await vscode.env.openExternal(vscode.Uri.parse(marketplaceUrl));
        }

        // ANY other action (clicking "Not Now", dismissing with X, or no response)
        // means never show again - respect the user's choice
        await this.context.globalState.update(this.DISMISSED_KEY, true);
    }

    /**
     * Manually trigger rating reminder (for testing or command)
     */
    async showNow(): Promise<void> {
        await this.showReminderNotification();
    }

    /**
     * Reset all rating reminder data (for testing)
     */
    async reset(): Promise<void> {
        await this.context.globalState.update(this.VERSION_KEY, undefined);
        await this.context.globalState.update(this.INSTALL_DATE_KEY, undefined);
        await this.context.globalState.update(this.FEATURE_COUNT_KEY, undefined);
        await this.context.globalState.update(this.DISMISSED_KEY, undefined);
    }

    /**
     * Get current reminder status (for debugging)
     */
    getStatus(): {
        installDate: number | undefined;
        featureCount: number;
        dismissed: boolean;
        lastShownVersion: string | undefined;
        daysSinceInstall: number;
    } {
        const installDate = this.context.globalState.get<number>(this.INSTALL_DATE_KEY);
        const featureCount = this.context.globalState.get<number>(this.FEATURE_COUNT_KEY, 0);
        const dismissed = this.context.globalState.get<boolean>(this.DISMISSED_KEY, false);
        const lastShownVersion = this.context.globalState.get<string>(this.VERSION_KEY);

        const daysSinceInstall = installDate
            ? (Date.now() - installDate) / (1000 * 60 * 60 * 24)
            : 0;

        return {
            installDate,
            featureCount,
            dismissed,
            lastShownVersion,
            daysSinceInstall
        };
    }
}
