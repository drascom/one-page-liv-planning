const scheduleEl = document.getElementById("schedule");
const weekTemplate = document.getElementById("week-template");

const scheduleData = {
  month: "June 2024",
  weeks: [
    {
      label: "Week 1",
      range: "Jun 3 – Jun 9",
      days: [
        {
          day: "Mon",
          patient: "Maria Silva",
          status: "Upcoming",
          surgeryType: "Rhinoplasty",
          forms: true,
          consents: true,
          payment: false,
        },
        {
          day: "Tue",
          patient: "Paulo Santos",
          status: "Completed",
          surgeryType: "Liposuction",
          forms: true,
          consents: true,
          payment: true,
        },
        {
          day: "Wed",
          patient: "Ana Costa",
          status: "Upcoming",
          surgeryType: "Bypass Revision",
          forms: false,
          consents: false,
          payment: false,
        },
        {
          day: "Thu",
          patient: "Miguel Rocha",
          status: "Cancelled",
          surgeryType: "Gastric Sleeve",
          forms: true,
          consents: true,
          payment: false,
        },
        {
          day: "Fri",
          patient: "Sara Ramos",
          status: "Upcoming",
          surgeryType: "Tummy Tuck",
          forms: false,
          consents: false,
          payment: false,
        },
      ],
    },
    {
      label: "Week 2",
      range: "Jun 10 – Jun 16",
      days: [
        {
          day: "Mon",
          patient: "Leo Carvalho",
          status: "Upcoming",
          surgeryType: "Septoplasty",
          forms: true,
          consents: false,
          payment: false,
        },
        {
          day: "Tue",
          patient: "Ines Faria",
          status: "Upcoming",
          surgeryType: "Facelift",
          forms: true,
          consents: true,
          payment: true,
        },
        {
          day: "Wed",
          patient: "Andre Sousa",
          status: "Completed",
          surgeryType: "Neck Lift",
          forms: true,
          consents: true,
          payment: true,
        },
        {
          day: "Thu",
          patient: "Rita Lopes",
          status: "Upcoming",
          surgeryType: "Otoplasty",
          forms: false,
          consents: false,
          payment: false,
        },
        {
          day: "Fri",
          patient: "Hugo Matos",
          status: "Upcoming",
          surgeryType: "Body Contour",
          forms: true,
          consents: false,
          payment: false,
        },
      ],
    },
    {
      label: "Week 3",
      range: "Jun 17 – Jun 23",
      days: [
        {
          day: "Mon",
          patient: "Joana Mendes",
          status: "Upcoming",
          surgeryType: "Arm Lift",
          forms: false,
          consents: false,
          payment: false,
        },
        {
          day: "Tue",
          patient: "Carlos Pires",
          status: "Completed",
          surgeryType: "Chest Reconstruction",
          forms: true,
          consents: true,
          payment: true,
        },
        {
          day: "Wed",
          patient: "Lara Viana",
          status: "Upcoming",
          surgeryType: "Brazilian Butt Lift",
          forms: true,
          consents: false,
          payment: false,
        },
        {
          day: "Thu",
          patient: "Noah Alves",
          status: "Upcoming",
          surgeryType: "Dermabrasion",
          forms: true,
          consents: true,
          payment: false,
        },
        {
          day: "Fri",
          patient: "Isabela Cruz",
          status: "Upcoming",
          surgeryType: "Mommy Makeover",
          forms: false,
          consents: false,
          payment: false,
        },
      ],
    },
    {
      label: "Week 4",
      range: "Jun 24 – Jun 30",
      days: [
        {
          day: "Mon",
          patient: "Rui Duarte",
          status: "Upcoming",
          surgeryType: "Hand Rejuvenation",
          forms: true,
          consents: true,
          payment: false,
        },
        {
          day: "Tue",
          patient: "Matilde Costa",
          status: "Upcoming",
          surgeryType: "Breast Reduction",
          forms: false,
          consents: false,
          payment: false,
        },
        {
          day: "Wed",
          patient: "Sofia Pires",
          status: "Completed",
          surgeryType: "Jawline Contour",
          forms: true,
          consents: true,
          payment: true,
        },
        {
          day: "Thu",
          patient: "Gabriel Reis",
          status: "Upcoming",
          surgeryType: "Thigh Lift",
          forms: true,
          consents: false,
          payment: false,
        },
        {
          day: "Fri",
          patient: "Beatriz Correia",
          status: "Cancelled",
          surgeryType: "Labiaplasty",
          forms: true,
          consents: true,
          payment: false,
        },
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

const CHECKED_ICON = {
  true: "☑",
  false: "☐",
};

function createCheckCell(value, label) {
  const cell = document.createElement("td");
  cell.classList.add("col-check");
  cell.dataset.label = label;

  const icon = document.createElement("span");
  icon.className = `check-icon ${value ? "check-icon--checked" : ""}`;
  icon.textContent = CHECKED_ICON[value];
  icon.setAttribute("aria-label", `${label} ${value ? "complete" : "missing"}`);

  cell.appendChild(icon);
  return cell;
}

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
    indexCell.dataset.label = "#";

    const dayCell = document.createElement("td");
    dayCell.textContent = day.day;
    dayCell.classList.add("col-day");
    dayCell.dataset.label = "Day";

    const patientCell = document.createElement("td");
    patientCell.textContent = day.patient;
    patientCell.classList.add("col-patient");
    patientCell.dataset.label = "Patient";

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.textContent = day.status;
    badge.className = `status-badge ${statusClasses[day.status] ?? ""}`;
    statusCell.appendChild(badge);
    statusCell.classList.add("col-status");
    statusCell.dataset.label = "Status";

    const surgeryCell = document.createElement("td");
    surgeryCell.textContent = day.surgeryType ?? "—";
    surgeryCell.classList.add("col-surgery");
    surgeryCell.dataset.label = "Surgery Type";

    const formsCell = createCheckCell(Boolean(day.forms), "Forms");
    const consentsCell = createCheckCell(Boolean(day.consents), "Consents");
    const paymentCell = createCheckCell(Boolean(day.payment), "Payment");

    row.append(
      indexCell,
      dayCell,
      patientCell,
      statusCell,
      surgeryCell,
      formsCell,
      consentsCell,
      paymentCell
    );
    tbody.appendChild(row);
  });

  scheduleEl.appendChild(clone);
}

scheduleData.weeks.forEach(renderWeek);
