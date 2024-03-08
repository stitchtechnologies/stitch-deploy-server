// day is monday, tuesday, etc
// time is 12:00 AM, 1:00 PM, etc
// check that current time is within the maintenance window
// check that the current day is between the startDay and endDay
// check that the current time is between the startTime and endTime
// handle AM and PM in the times

function getCurrentDay(): string {
    const date = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
}

export function isCurrentTimeWithinMaintenanceWindow(
    startDay: string,
    startTime: string,
    endDay: string,
    endTime: string,
): boolean {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const currentDay = getCurrentDay();
    const currentHour = new Date().getHours();
    const currentMinute = new Date().getMinutes();
    const startDayIndex = days.indexOf(startDay);
    const endDayIndex = days.indexOf(endDay);
    const currentDayIndex = days.indexOf(currentDay);

    // handle AM and PM
    let startTimeHour = parseInt(startTime.split(':')[0]);
    const startTimeMinute = parseInt(startTime.split(':')[1]);
    let endTimeHour = parseInt(endTime.split(':')[0]);
    const endTimeMinute = parseInt(endTime.split(':')[1]);
    const isStartTimeAM = startTime.includes('AM');
    const isEndTimeAM = endTime.includes('AM');
    const isCurrentTimeAM = currentHour < 12;

    // check that the current day is between the startDay and endDay
    if (currentDayIndex < startDayIndex || currentDayIndex > endDayIndex) {
        return false;
    }

    // check that the current time is between the startTime and endTime
    // handle AM and PM
    if (isStartTimeAM && !isCurrentTimeAM) {
        startTimeHour += 12;
    }
    if (isEndTimeAM && !isCurrentTimeAM) {
        endTimeHour += 12;
    }
    if (currentHour < startTimeHour || currentHour > endTimeHour) {
        return false;
    }
    if (currentHour === startTimeHour && currentMinute < startTimeMinute) {
        return false;
    }
    if (currentHour === endTimeHour && currentMinute > endTimeMinute) {
        return false;
    }

    return true;
}