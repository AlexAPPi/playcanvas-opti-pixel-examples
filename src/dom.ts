import { t } from './i18n.ts';

export function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
        throw new Error(t('markupMissing'));
    }
    return element;
}
