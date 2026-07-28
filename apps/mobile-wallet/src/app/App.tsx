import { useEffect, useState } from 'react';
import { ReadOnlyAccountView } from '../accounts';
import { MobileWalletShell } from '../navigation';
import { bootstrapMobileWallet } from './bootstrap';
import { isDeviceCompromised } from '../security/jailbreak';
import { JailbreakWarningScreen } from '../screens/JailbreakWarningScreen';

interface Props {
  env: Record<string, string | undefined>;
}

export const MobileWalletApp = ({ env }: Props) => {
  const bootstrap = bootstrapMobileWallet(env);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (isDeviceCompromised()) {
      setBlocked(true);
    }
  }, []);

  if (blocked) {
    // eslint-disable-next-line no-undef
    const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
    return (
      <JailbreakWarningScreen onContinueAnyway={IS_DEV ? () => setBlocked(false) : undefined} />
    );
  }

  return (
    <MobileWalletShell appName={bootstrap.environment.appName} activeRoute="account">
      <ReadOnlyAccountView
        account={bootstrap.account}
        accountContractId={bootstrap.sdk.accountContractId}
      />
    </MobileWalletShell>
  );
};
