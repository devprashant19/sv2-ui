import { useState, useEffect } from 'react';
import { StepProps } from '../types';
import { Info } from 'lucide-react';
import { isValidBitcoinAddress, getBitcoinAddressError } from '@/lib/utils';

const SRI_POOL_AUTHORITY_KEY = '9auqWEzQDVyd2oe1JVGFLMLHZtCo2FFqZwtKA5gd9xbuEu7PH72';

interface SriIdentityParts {
  address: string;
  workerName: string;
  donationPercent: number;
}

function parseSriIdentity(identity: string): SriIdentityParts {
  if (identity.startsWith('sri/solo/')) {
    const rest = identity.slice('sri/solo/'.length);
    const idx = rest.indexOf('/');
    if (idx === -1) return { address: rest, workerName: '', donationPercent: 0 };
    return { address: rest.slice(0, idx), workerName: rest.slice(idx + 1), donationPercent: 0 };
  }

  if (identity === 'sri/donate') {
    return { address: '', workerName: '', donationPercent: 100 };
  }

  if (identity.startsWith('sri/donate/')) {
    const rest = identity.slice('sri/donate/'.length);
    const parts = rest.split('/');
    const pct = parseInt(parts[0], 10);
    if (!isNaN(pct) && String(pct) === parts[0] && parts.length >= 2) {
      return { address: parts[1], workerName: parts.slice(2).join('/'), donationPercent: pct };
    }
    return { address: '', workerName: rest, donationPercent: 100 };
  }

  return { address: identity, workerName: '', donationPercent: 0 };
}

function buildSriIdentity(address: string, workerName: string, donationPercent: number): string {
  const addr = address.trim();
  const worker = workerName.trim();

  if (donationPercent >= 100) {
    return worker ? `sri/donate/${worker}` : 'sri/donate';
  }

  if (donationPercent > 0 && donationPercent < 100) {
    if (!addr) return '';
    return worker
      ? `sri/donate/${donationPercent}/${addr}/${worker}`
      : `sri/donate/${donationPercent}/${addr}`;
  }

  if (!addr) return '';
  return worker ? `sri/solo/${addr}/${worker}` : `sri/solo/${addr}`;
}

export function MiningIdentityStep({ data, updateData, onNext }: StepProps) {
  const isSoloMode = data.miningMode === 'solo';
  const isJdMode = data.mode === 'jd';
  const isSriPool = data.pool?.authority_public_key === SRI_POOL_AUTHORITY_KEY;
  const useSriConventions = isSoloMode && isSriPool;

  const existingIdentity = data.translator?.user_identity || data.jdc?.user_identity || '';
  const parsed = useSriConventions ? parseSriIdentity(existingIdentity) : { address: '', workerName: '', donationPercent: 0 };

  const [payoutAddress, setPayoutAddress] = useState(useSriConventions ? parsed.address : '');
  const [workerName, setWorkerName] = useState(useSriConventions ? parsed.workerName : '');
  const [donationPercent, setDonationPercent] = useState(useSriConventions ? parsed.donationPercent : 0);

  const [userIdentity, setUserIdentity] = useState(!useSriConventions ? existingIdentity : '');
  const [coinbaseAddress, setCoinbaseAddress] = useState(data.jdc?.coinbase_reward_address || '');

  const finalIdentity = useSriConventions
    ? buildSriIdentity(payoutAddress, workerName, donationPercent)
    : userIdentity;

  useEffect(() => {
    updateData({
      jdc: isJdMode
        ? { user_identity: finalIdentity, coinbase_reward_address: coinbaseAddress, jdc_signature: data.jdc?.jdc_signature || '' }
        : null,
      translator: data.translator
        ? { ...data.translator, user_identity: finalIdentity, enable_vardiff: true }
        : { user_identity: finalIdentity, enable_vardiff: true, aggregate_channels: false, min_hashrate: 0 },
    });
  }, [finalIdentity, coinbaseAddress, isJdMode, data.jdc?.jdc_signature, data.translator, updateData]);

  const network = data.bitcoin?.network ?? 'mainnet';
  const needsAddress = donationPercent < 100;

  const isValid = useSriConventions
    ? (!needsAddress || (payoutAddress.trim().length > 0 && isValidBitcoinAddress(payoutAddress.trim(), network)))
    : (userIdentity.length > 0 &&
       (!isSoloMode || isValidBitcoinAddress(userIdentity, network)) &&
       (!isJdMode || isValidBitcoinAddress(coinbaseAddress, network)));

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3">Mining Identity</h2>
        <p className="text-lg text-muted-foreground">
          {useSriConventions
            ? 'Configure your solo mining payout'
            : isSoloMode
              ? 'Configure your mining identity'
              : 'Configure your pool credentials'}
        </p>
      </div>

      {useSriConventions ? (
        <>
          {needsAddress && (
            <div>
              <label htmlFor="payout-address" className="block text-sm font-medium mb-2">
                Bitcoin Payout Address <span className="text-primary" aria-hidden="true">*</span>
                <span className="sr-only">(required)</span>
              </label>
              <input
                id="payout-address"
                type="text"
                value={payoutAddress}
                onChange={(e) => setPayoutAddress(e.target.value)}
                placeholder="bc1q..."
                aria-required="true"
                autoComplete="off"
                className="w-full h-10 px-3 rounded-lg border border-input bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 outline-none transition-all font-mono text-sm"
              />
              {getBitcoinAddressError(payoutAddress, network) && (
                <p className="text-xs text-destructive mt-1">{getBitcoinAddressError(payoutAddress, network)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Your Bitcoin address where you want to receive mining rewards
              </p>
            </div>
          )}

          <div>
            <label htmlFor="worker-name" className="block text-sm font-medium mb-2">
              Worker Name <span className="text-muted-foreground text-xs font-normal">(optional)</span>
            </label>
            <input
              id="worker-name"
              type="text"
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
              placeholder="worker1"
              autoComplete="off"
              className="w-full h-10 px-3 rounded-lg border border-input bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 outline-none transition-all font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              A name to identify this mining device
            </p>
          </div>

          <div>
            <label htmlFor="donation-slider" className="block text-sm font-medium mb-2">
              Donation to SRI Development <span className="text-muted-foreground text-xs font-normal">(optional)</span>
            </label>
            <div className="p-4 rounded-xl bg-muted/40 space-y-3">
              <input
                id="donation-slider"
                type="range"
                min={0}
                max={100}
                value={donationPercent}
                onChange={(e) => setDonationPercent(Number(e.target.value))}
                aria-label={`Donation: ${donationPercent}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={donationPercent}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground select-none">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {donationPercent === 0
                ? 'Full block reward goes to your payout address'
                : donationPercent >= 100
                  ? 'Full block reward is donated to SRI development'
                  : `${donationPercent}% of the block reward goes to SRI development, ${100 - donationPercent}% to your address`}
            </p>
          </div>

          {finalIdentity && (
            <div className="p-3 rounded-xl bg-muted/40 flex gap-3" role="note">
              <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm">
                <p className="text-muted-foreground mb-1">User identity that will be sent to the pool:</p>
                <p className="font-mono text-xs text-foreground break-all">{finalIdentity}</p>
              </div>
            </div>
          )}
        </>
      ) : (
        <div>
          <label htmlFor="user-identity" className="block text-sm font-medium mb-2">
            {isSoloMode ? 'Bitcoin Address' : 'Pool Username'} <span className="text-primary" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </label>
          <input
            id="user-identity"
            type="text"
            value={userIdentity}
            onChange={(e) => setUserIdentity(e.target.value)}
            placeholder={isSoloMode ? 'bc1q...' : 'username.worker1'}
            aria-required="true"
            autoComplete="off"
            className="w-full h-10 px-3 rounded-lg border border-input bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 outline-none transition-all font-mono text-sm"
          />
          {isSoloMode && getBitcoinAddressError(userIdentity, network) && (
            <p className="text-xs text-destructive mt-1">{getBitcoinAddressError(userIdentity, network)}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {isSoloMode
              ? 'Your Bitcoin address where you want to receive mining rewards'
              : 'Your pool account username (e.g., username.workername)'}
          </p>
        </div>
      )}

      {isJdMode && (
        <div>
          <label htmlFor="coinbase-address" className="block text-sm font-medium mb-2">
            Fallback Bitcoin Address <span className="text-primary" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </label>

          <div className="mb-3 p-3 rounded-xl bg-muted/40 flex gap-3" role="note">
            <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Used for coinbase rewards if the Job Declarator falls back to solo mining due to pool connection issues.
            </p>
          </div>

          <input
            id="coinbase-address"
            type="text"
            value={coinbaseAddress}
            onChange={(e) => setCoinbaseAddress(e.target.value)}
            placeholder="bc1q..."
            aria-required="true"
            autoComplete="off"
            className="w-full h-10 px-3 rounded-lg border border-input bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 outline-none transition-all font-mono text-sm"
          />
          {getBitcoinAddressError(coinbaseAddress, network) && (
            <p className="text-xs text-destructive mt-1">{getBitcoinAddressError(coinbaseAddress, network)}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Bitcoin address for receiving rewards during solo mining fallback
          </p>
        </div>
      )}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onNext}
          disabled={!isValid}
          className="h-11 px-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors font-medium"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
