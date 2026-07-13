import NetInfo from "@react-native-community/netinfo";

/**
 * Single app-wide snapshot of network reachability.
 *
 * Every sender used to find out it was offline by firing a fetch and waiting
 * for it to fail — on a phone with zero coverage each attempt keeps the cell
 * radio in its high-power search state, which is what cooked the battery at
 * remote events. Senders should consult `isOnline()` BEFORE touching the
 * network and queue immediately when it's false.
 *
 * `isInternetReachable` can be `null` (unknown) right after a transition;
 * treat unknown as online so a wrong cached "offline" can never block sends.
 */
let online = true;

NetInfo.fetch()
  .then((state) => {
    online = state.isConnected === true && state.isInternetReachable !== false;
  })
  .catch(() => undefined);

NetInfo.addEventListener((state) => {
  online = state.isConnected === true && state.isInternetReachable !== false;
});

export function isOnline(): boolean {
  return online;
}
