import React from "react";

const PositionDetailDetails = ({ position }) => {
    return (
        <ul>
            <li>Position Title: {position?.name}</li>
            <li>Department: {position?.department.name}</li>
            <li>Details: {position?.description}</li>
            <li>Fixed End Date: {position?.end_date ?? "No Fixed End Date"}</li>
            <li>
                Fixed Start Date:{" "}
                {position?.start_date ?? "No Fixed Start Date"}
            </li>
            <li>Pay Grade: {position?.grade.name}</li>
            <li>
                Position currently occupied by:{" "}
                {position?.user
                    ? `${position.user.first_name} ${position.user.last_name}`
                    : "Not occupied"}
            </li>
        </ul>
    );
};

export default PositionDetailDetails;
