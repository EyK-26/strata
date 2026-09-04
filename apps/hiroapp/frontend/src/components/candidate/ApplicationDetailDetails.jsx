import React, { useContext } from "react";
import Context from "../../context/Context";
import { Link } from "react-router-dom";

const ApplicationDetailDetails = ({ application }) => {
    const { state } = useContext(Context);
    return (
        <div className="ApplicationDetailDetails">
            <span className="pageType">
                {state.user.role_id === 2
                    ? "Details of your application:"
                    : "Manage Application"}
            </span>
            <div>
                <span className="info-name">Position title: </span>
                <span>{application.position.name}</span>
            </div>
            <div>
                <span className="info-name">Department: </span>
                <span> {application.position?.department.name}</span>
            </div>
            <div className="info-details">
                <span className="info-name">Details of the Position: </span>
                <span className="info-text">
                    {application.position.description}
                </span>
            </div>
            {state.user.role_id === 3 && (
                <div>
                    <span className="info-name">Applicant: </span>
                    <Link to={`/users/${application.user.id}`}>
                        <span>
                            {application.user.first_name}{" "}
                            {application.user.last_name}
                        </span>
                    </Link>
                </div>
            )}
            <div>
                {application.attachment_text || application.attachment_file ? (
                    <span className="SubmittedInformation">
                        Submitted Information
                    </span>
                ) : (
                    ""
                )}
                {application.attachment_text && (
                    <div className="info-details">
                        <span className="info-name">
                            Your motivation text:{" "}
                        </span>
                        <span className="info-text">
                            {application.attachment_text}
                        </span>
                    </div>
                )}
                {application.attachment_file && (
                    <div>
                        <span className="info-name">submitted url: </span>
                        <a
                            href={application.attachment_file}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {application.attachment_file}
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ApplicationDetailDetails;
