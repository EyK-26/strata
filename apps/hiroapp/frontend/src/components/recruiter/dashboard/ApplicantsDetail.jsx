import React from "react";
import { Link } from "react-router-dom";

const ApplicantsDetail = ({ detailData }) => {
    const renderedDetailData = detailData.map((data) => (
        <div key={data.id} className="ApplicantsDetail">
            <span className="ApplicantDetail_candidate">
                <div>
                    Candidate:{" "}
                    <Link to={`/users/${data.user?.id}`}>
                        {data.user?.first_name} {data.user?.last_name}
                    </Link>{" "}
                </div>
                <div>Status: {data.status?.name}</div>
            </span>
            <span>
                Applied To:{" "}
                <Link to={`/positions/${data.position?.id}`}>
                    {data.position?.name}
                </Link>
            </span>
            <span>
                <Link to={`/applications/${data.id}`}>Go to application</Link>
            </span>
        </div>
    ));
    return <div>{renderedDetailData}</div>;
};

export default ApplicantsDetail;
