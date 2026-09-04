import React from "react";
import TotalApplicants from "./Applicants";

const Dashboard = ({ setToggleDashboard }) => {
    return (
        <>
            <div className="Dashboard">
                <TotalApplicants />
                <TotalApplicants isMonthRestricted />
                <TotalApplicants isFeedbackRestricted />
                <TotalApplicants isHiredRestricted />
                <TotalApplicants isRejectedRestricted />
                <TotalApplicants isInterviewRestricted />
                <button
                    className="Dashboard_close"
                    onClick={() => setToggleDashboard(false)}
                >
                    close
                </button>
            </div>
        </>
    );
};

export default Dashboard;
