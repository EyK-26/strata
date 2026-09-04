import axios from "axios";
import React, { useContext, useEffect, useState } from "react";
import Context from "../../context/Context";
import InterviewForm from "../recruiter/InterviewForm";
import Hire from "./popups/Hire";
import Reject from "./popups/Reject";

const ApplicationDetailStatus = ({
    allStatuses,
    application,
    setIsEnded,
    setMoveCount,
}) => {
    const [isRejectPopupOpen, setIsRejectPopupOpen] = useState(false);
    const [isInterviewPopupOpen, setIsInterviewPopupOpen] = useState(null);
    const [isHirePopupOpen, setIsHirePopupOpen] = useState(false);
    const [isInterviewSet, setIsInterviewSet] = useState(false);
    const [isProcessingQuery, setIsProcessingQuery] = useState(false);
    const { state } = useContext(Context);

    const handleMove = async () => {
        if (application.status.id === 2 && !isInterviewSet) {
            setIsInterviewPopupOpen(true);
            return;
        } else if (application.status.id !== 2 || isInterviewSet) {
            try {
                const response = await axios.post(
                    `/api/applications/${application.id}/move`,
                );
                setMoveCount((prev) => prev + 1);
                setIsHirePopupOpen(false);
                setIsProcessingQuery(false);
            } catch (err) {
                console.log(err.response);
            }
        }
    };

    const handleEnd = async () => {
        try {
            const response = await axios.post(
                `/api/applications/${application.id}/end`,
            );
            setIsEnded(true);
            setIsRejectPopupOpen(false);
            setIsProcessingQuery(false);
        } catch (err) {
            console.log(err.response);
        }
    };

    useEffect(() => {
        if (isInterviewPopupOpen !== null) {
            handleMove();
        }
    }, [isInterviewSet]);

    const renderedAllStatuses = allStatuses.map((status) => {
        const isCurrent =
            status.id === application.status.id && state.user.role_id !== 2;
        const renderMoveBtn = isCurrent && application.status.id < 4;
        const renderHireBtn = isCurrent && application.status.id === 4;

        let className = "status";
        if (status.id === 6) {
            className += " ended";
        }
        if (status.id < application.status.id) {
            className += " status-done";
        } else if (status.id === application.status.id) {
            className += " status-active";
        } else {
            className += " status-future";
        }

        return (
            <div key={status.id} className={className}>
                {status.id !== 1 && status.id < 6 ? (
                    <div
                        className={
                            status.id === 2
                                ? "line first"
                                : status.id === 5
                                ? "line last"
                                : "line"
                        }
                    ></div>
                ) : (
                    ""
                )}
                <div className="circle"></div>
                <span>{status.name}</span>
                {isCurrent &&
                    (renderMoveBtn ? (
                        <button onClick={handleMove}>Move To Next Stage</button>
                    ) : (
                        renderHireBtn && (
                            <button
                                onClick={() => {
                                    setIsHirePopupOpen(true);
                                    setIsRejectPopupOpen(false);
                                }}
                            >
                                Hire
                            </button>
                        )
                    ))}
            </div>
        );
    });

    return (
        <div className="ApplicationDetailStatus">
            <div className="topPart">
                {application.status.id < 5 && (
                    <button
                        onClick={() => {
                            setIsRejectPopupOpen(true);
                            setIsHirePopupOpen(false);
                        }}
                    >
                        {state.user.role_id === 2
                            ? "Retrieve Your Application"
                            : "Reject"}
                    </button>
                )}
                {isProcessingQuery && (
                    <span className="processing">Processing...</span>
                )}
            </div>
            <div className="interactivePart">
                {isRejectPopupOpen && (
                    <Reject
                        setIsProcessingQuery={setIsProcessingQuery}
                        setIsRejectPopupOpen={setIsRejectPopupOpen}
                        handleEnd={handleEnd}
                    />
                )}
                {isHirePopupOpen && (
                    <Hire
                        setIsProcessingQuery={setIsProcessingQuery}
                        setIsHirePopupOpen={setIsHirePopupOpen}
                        handleMove={handleMove}
                        application={application}
                    />
                )}
                {application.status.id === 2 && isInterviewPopupOpen && (
                    <InterviewForm
                        applicant={application.user}
                        position={application.position}
                        setIsInterviewPopupOpen={setIsInterviewPopupOpen}
                        setIsInterviewSet={setIsInterviewSet}
                        setIsProcessingQuery={setIsProcessingQuery}
                    />
                )}
            </div>
            <div
                className={
                    state.user.role_id !== 2 ? "progress hasButton" : "progress"
                }
            >
                {renderedAllStatuses}
            </div>
        </div>
    );
};

export default ApplicationDetailStatus;
