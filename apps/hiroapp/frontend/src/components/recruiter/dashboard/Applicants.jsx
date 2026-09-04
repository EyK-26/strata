import React, { useContext, useEffect, useState } from "react";
import Context from "../../../context/Context";
import ApplicantsDetail from "./ApplicantsDetail";
import axios from "axios";

const Applicants = (props) => {
    const { state } = useContext(Context);
    const [data, setData] = useState(0);
    const [detailData, setDetailData] = useState([]);
    const [isDetailDataExpanded, setIsDetailDataExpanded] = useState(false);
    const params = {
        department_id: state.user?.position?.department.id,
        isMonthRestricted: props.isMonthRestricted,
        isFeedbackRestricted: props.isFeedbackRestricted,
        isHiredRestricted: props.isHiredRestricted,
        isRejectedRestricted: props.isRejectedRestricted,
        isInterviewRestricted: props.isInterviewRestricted,
    };

    const fetchTotalApplicants = async () => {
        try {
            const response = await axios.get("/api/dashboard/count", {
                params: {
                    ...params,
                },
            });
            setData(response.data);
        } catch (err) {
            console.log(err.response);
        }
    };

    const fetchTotalApplicantsDetail = async () => {
        try {
            const response = await axios.get("/api/dashboard/data", {
                params: {
                    ...params,
                },
            });
            setDetailData(response.data);
        } catch (err) {
            console.log(err.response);
        }
    };

    useEffect(() => {
        fetchTotalApplicants();
    }, []);

    useEffect(() => {
        if (isDetailDataExpanded) {
            fetchTotalApplicantsDetail();
        }
    }, [isDetailDataExpanded]);

    return (
        <div className="Applicants">
            <h3>
                {props.isMonthRestricted
                    ? "Candidates Applied This Month"
                    : props.isFeedbackRestricted
                    ? "Candidates Awating Feedback"
                    : props.isHiredRestricted
                    ? "Candidates Hired"
                    : props.isRejectedRestricted
                    ? "Candidates Declined"
                    : props.isInterviewRestricted
                    ? "Candidates with scheduled interviews"
                    : "Total Number of Candidates"}
            </h3>
            {data && (
                <span
                    className="dashboard_number"
                    onClick={() => setIsDetailDataExpanded((prev) => !prev)}
                >
                    {data}
                </span>
            )}
            <div className="ApplicantDetail_container">
                {detailData && isDetailDataExpanded && (
                    <ApplicantsDetail detailData={detailData} />
                )}
            </div>
        </div>
    );
};

export default Applicants;
