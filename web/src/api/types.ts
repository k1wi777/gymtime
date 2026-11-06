import type { components } from './schema';

type Schemas = components['schemas'];

export type Account = Schemas['AccountResponseDto'];
export type PanelRole = Account['role'];
export type PanelNow = Schemas['PanelNowDto'];
export type PanelPerson = Schemas['PanelPersonDto'];
export type Roster = Schemas['RosterDto'];
export type RosterRow = Schemas['RosterRowDto'];
export type Student = Schemas['StudentResponseDto'];
export type Enrollment = Schemas['EnrollmentResponseDto'];
export type AlarmStatus = Schemas['AlarmStatusDto'];
export type AlarmOffResult = Schemas['AlarmOffResultDto'];
export type DeviceStatus = Schemas['DeviceStatusDto'];
export type Schedule = Schemas['ScheduleResponseDto'];
export type Session = Schemas['SessionDto'];

/** One frame of `GET /events`, discriminated by `type`. */
export type SystemEvent =
  | Schemas['DeviceConnectedEventDto']
  | Schemas['DeviceDisconnectedEventDto']
  | Schemas['ScanEventDto']
  | Schemas['CommandEventDto']
  | Schemas['AlarmEventDto']
  | Schemas['AttendanceEventDto']
  | Schemas['EnrollmentEventDto']
  | Schemas['KeepaliveEventDto'];

export type SystemEventType = SystemEvent['type'];
export type EventOf<T extends SystemEventType> = Extract<
  SystemEvent,
  { type: T }
>;
