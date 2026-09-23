import { Controller, Get, Header, HttpCode } from "@nestjs/common";

/**
 * Reachability probe for the mobile app's connectivity gate and the coverage
 * survey.
 *
 * On iOS the only way to know whether traffic really gets out is to send some.
 * NetInfo used to do that against a Google page every 60 s (every 5 s while
 * failing), around the clock. The app now asks US, and only when its real
 * traffic hasn't already answered the question — see
 * apps/mobile/src/offline/connectivity.ts.
 *
 * Asking our own server is also the more truthful answer for the survey: the
 * question a coordinator has is "can this medic reach the command centre from
 * here", not "can they reach Google".
 *
 * Deliberately the cheapest thing the API can serve: no auth (a probe must not
 * depend on a valid session), no database, no body. Its own controller, because
 * CoverageController is guarded as a whole.
 */
@Controller("coverage")
export class CoverageProbeController {
  @Get("probe")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  probe(): void {
    // 204, empty — the round trip is the measurement.
  }
}
