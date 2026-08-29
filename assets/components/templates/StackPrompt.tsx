import { useEffect, useState } from 'react';
import type { TemplateRule } from '@/types/api';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { today } from '@/utils/timeline';
import { t } from '@/i18n/fr';

interface StackPromptProps {
    existing: TemplateRule;
    open: boolean;
    onCancel: () => void;
    onReplace: () => void;
    onAlternate: (startDate: string) => void;
}

export default function StackPrompt({ existing, open, onCancel, onReplace, onAlternate }: StackPromptProps) {
    const [step, setStep] = useState<'choice' | 'date'>('choice');
    const [startDate, setStartDate] = useState(today());

    // Réinitialise à chaque ouverture
    useEffect(() => {
        if (open) { setStep('choice'); setStartDate(today()); }
    }, [open]);

    const alreadyRotation = existing.rotationGroupId !== null;

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-base">{t('templates.stack.title')}</DialogTitle>
                </DialogHeader>

                {alreadyRotation ? (
                    <>
                        <p className="text-sm text-muted-foreground">{t('templates.stack.rotation_exists')}</p>
                        <DialogFooter>
                            <Button size="sm" variant="outline" onClick={onCancel}>
                                {t('templates.stack.cancel')}
                            </Button>
                        </DialogFooter>
                    </>
                ) : step === 'choice' ? (
                    <div className="flex flex-col gap-2">
                        <Button size="sm" onClick={onReplace}>{t('templates.stack.replace')}</Button>
                        <Button size="sm" variant="secondary" onClick={() => setStep('date')}>
                            {t('templates.stack.alternate')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={onCancel}>
                            {t('templates.stack.cancel')}
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">{t('templates.stack.start_date_title')}</label>
                        <input
                            type="date"
                            min={today()}
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="h-8 rounded-md border border-input px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        />
                        <p className="text-[12px] text-muted-foreground">{t('templates.stack.start_date_hint')}</p>
                        <DialogFooter>
                            <Button size="sm" variant="outline" onClick={onCancel}>
                                {t('templates.stack.cancel')}
                            </Button>
                            <Button size="sm" onClick={() => onAlternate(startDate)}>
                                {t('templates.stack.confirm_alternate')}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
