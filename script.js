const scheduleEl = document.getElementById("schedule");
const weekTemplate = document.getElementById("week-template");

const scheduleData = {
  month: "June 2024",
  weeks: [
    {
      label: "Week 1",
      range: "Jun 3 – Jun 9",
      days: [
        { day: "Mon", patient: "Maria Silva", status: "Upcoming" },
        { day: "Tue", patient: "Paulo Santos", status: "Completed" },
        { day: "Wed", patient: "Ana Costa", status: "Upcoming" },
        { day: "Thu", patient: "Miguel Rocha", status: "Cancelled" },
        { day: "Fri", patient: "Sara Ramos", status: "Upcoming" },
      ],
    },
    {
      label: "Week 2",
      range: "Jun 10 – Jun 16",
      days: [
        { day: "Mon", patient: "Leo Carvalho", status: "Upcoming" },
        { day: "Tue", patient: "Ines Faria", status: "Upcoming" },
        { day: "Wed", patient: "Andre Sousa", status: "Completed" },
        { day: "Thu", patient: "Rita Lopes", status: "Upcoming" },
        { day: "Fri", patient: "Hugo Matos", status: "Upcoming" },
      ],
    },
    {
      label: "Week 3",
      range: "Jun 17 – Jun 23",
      days: [
        { day: "Mon", patient: "Joana Mendes", status: "Upcoming" },
        { day: "Tue", patient: "Carlos Pires", status: "Completed" },
        { day: "Wed", patient: "Lara Viana", status: "Upcoming" },
        { day: "Thu", patient: "Noah Alves", status: "Upcoming" },
        { day: "Fri", patient: "Isabela Cruz", status: "Upcoming" },
      ],
    },
    {
      label: "Week 4",
      range: "Jun 24 – Jun 30",
      days: [
        { day: "Mon", patient: "Rui Duarte", status: "Upcoming" },
        { day: "Tue", patient: "Matilde Costa", status: "Upcoming" },
        { day: "Wed", patient: "Sofia Pires", status: "Completed" },
        { day: "Thu", patient: "Gabriel Reis", status: "Upcoming" },
        { day: "Fri", patient: "Beatriz Correia", status: "Cancelled" },
      ],
    },
  ],
};

const statusClasses = {
  Upcoming: "status-upcoming",
  Completed: "status-completed",
  Cancelled: "status-cancelled",
};

const monthLabel = document.getElementById("selected-month");
const weekCount = document.getElementById("week-count");
monthLabel.textContent = scheduleData.month;
weekCount.textContent = `${scheduleData.weeks.length} weeks scheduled`;

function renderWeek(week, index) {
  const clone = weekTemplate.content.cloneNode(true);
  clone.querySelector(".week__title").textContent = week.label;
  clone.querySelector(".week__range").textContent = week.range;
  const tbody = clone.querySelector("tbody");

  week.days.forEach((day, dayIndex) => {
    const row = document.createElement("tr");

    const indexCell = document.createElement("td");
    indexCell.textContent = `${index + 1}.${dayIndex + 1}`;
    indexCell.classList.add("col-index");

    const dayCell = document.createElement("td");
    dayCell.textContent = day.day;
    dayCell.classList.add("col-day");

    const patientCell = document.createElement("td");
    patientCell.textContent = day.patient;
    patientCell.classList.add("col-patient");

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.textContent = day.status;
    badge.className = `status-badge ${statusClasses[day.status] ?? ""}`;
    statusCell.appendChild(badge);

    row.append(indexCell, dayCell, patientCell, statusCell);
    tbody.appendChild(row);
  });

  scheduleEl.appendChild(clone);
}

scheduleData.weeks.forEach(renderWeek);
