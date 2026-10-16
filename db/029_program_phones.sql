-- db/029_program_phones.sql
-- Cited program phone numbers (2026-10-16). A number is only ever copied
-- from the program's own page; the page it came from and the hours that
-- page states are stored with it, so the call card can cite both.
-- Read by lib/programPhone.ts (chat "Call the program" + demo call card).
-- Applies to: Supabase project iwayoxmpbueneagdkpzj. Idempotent: yes.

alter table exploits add column if not exists support_phone_source_url text;
alter table exploits add column if not exists support_phone_hours text;

-- ELIQUIS 360 Support, the program that runs the Direct-to-Patient option
-- (BMS/Pfizer release: available at eliquis.bmscustomerconnect.com/support).
-- That page, checked 2026-10-16: "Ways to reach ELIQUIS 360 Support ...
-- calling 1-855-ELIQUIS (354-7847) Monday to Friday, 8 AM to 8 PM ET;
-- Saturday to Sunday, 9 AM to 6 PM ET".
update exploits
set support_phone = '1-855-354-7847',
    support_phone_source_url = 'https://www.eliquis.bmscustomerconnect.com/support',
    support_phone_hours = 'Monday to Friday, 8 AM to 8 PM ET; Saturday and Sunday, 9 AM to 6 PM ET'
where title like 'Eliquis Direct-to-Patient Program%' and support_phone is null;

-- Bristol Myers Squibb Patient Assistance Foundation. bms.com "Get help
-- paying for your medicines", checked 2026-10-16: "Visit bmspaf.org or
-- call 800-736-0003." That page states no hours, so none are stored.
update exploits
set support_phone = '1-800-736-0003',
    support_phone_source_url = 'https://www.bms.com/patient-and-caregivers/get-help-paying-for-your-medicines.html'
where title = 'Bristol Myers Squibb Patient Assistance Foundation' and support_phone is null;

-- The co-pay card number set by db/021: record the page it came from
-- (still shown there 2026-10-16: "Call 1-855-ELIQUIS (354-7847)").
update exploits
set support_phone_source_url = 'https://www.eliquis.bmscustomerconnect.com/price'
where title like 'Eliquis Co-pay Card%' and support_phone is not null and support_phone_source_url is null;
